/**
 * Crypto Web Worker
 *
 * Holds the KairoxVault instance so that all key material — master key,
 * symmetric key, identity keypair — lives ONLY in the worker context and
 * is never accessible from the main thread or page scripts.
 *
 * The Argon2id KDF runs here so it never blocks the UI thread.
 *
 * Communication: postMessage with typed WorkerRequest / WorkerResponse objects.
 * Binary data is transferred with zero-copy Transferable (ArrayBuffer).
 */

/// <reference lib="webworker" />

import init, {
  KairoxVault,
  generate_collection_key,
  generate_salt,
} from 'kairox-crypto-wasm';
// Vite resolves this ?url import to the asset's served URL at build time,
// so init() receives the correct URL regardless of the worker's own location.
import wasmUrl from 'kairox-crypto-wasm/kairox_crypto_bg.wasm?url';
import type { WorkerRequest, WorkerResponse } from './types.js';

// ── State ─────────────────────────────────────────────────────────────────────

let vault: KairoxVault | null = null;
let wasmReady = false;

async function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    await init(wasmUrl);
    wasmReady = true;
  }
}

function requireVault(): KairoxVault {
  if (!vault) throw new Error('Vault is locked. Call derive first.');
  return vault;
}

// ── Message handler ───────────────────────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    await ensureWasm();

    switch (req.type) {
      case 'derive': {
        // Drop any existing vault to trigger Rust zeroize
        if (vault) { vault.free(); vault = null; }

        vault = new KairoxVault(req.password, req.salt);

        const result = {
          authKey:   vault.auth_key(),
          publicKey: vault.public_key(),
        };
        reply(req.id, result, [result.authKey.buffer, result.publicKey.buffer]);
        break;
      }

      case 'encrypt': {
        const ct = requireVault().encrypt(req.plaintext, req.aad);
        reply(req.id, ct, [ct.buffer]);
        break;
      }

      case 'decrypt': {
        const pt = requireVault().decrypt(req.ciphertext, req.aad);
        reply(req.id, pt, [pt.buffer]);
        break;
      }

      case 'encrypt_with_key': {
        const ct = requireVault().encrypt_with_key(req.key, req.plaintext, req.aad);
        reply(req.id, ct, [ct.buffer]);
        break;
      }

      case 'decrypt_with_key': {
        const pt = requireVault().decrypt_with_key(req.key, req.ciphertext, req.aad);
        reply(req.id, pt, [pt.buffer]);
        break;
      }

      case 'wrap_key_for': {
        const wrapped = requireVault().wrap_key_for(
          req.recipient_public,
          req.key_material,
          req.aad,
        );
        reply(req.id, wrapped, [wrapped.buffer]);
        break;
      }

      case 'unwrap_key': {
        const ck = requireVault().unwrap_key(req.wrapped, req.aad);
        reply(req.id, ck, [ck.buffer]);
        break;
      }

      case 'generate_collection_key': {
        const ck = generate_collection_key();
        reply(req.id, ck, [ck.buffer]);
        break;
      }

      case 'generate_salt': {
        const s = generate_salt();
        reply(req.id, s, [s.buffer]);
        break;
      }

      case 'lock': {
        if (vault) { vault.free(); vault = null; }
        reply(req.id, null);
        break;
      }
    }
  } catch (err) {
    const msg: WorkerResponse = { id: req.id, type: 'error', message: String(err) };
    (self as unknown as Worker).postMessage(msg);
  }
};

function reply(id: string, data: unknown, transfer: Transferable[] = []): void {
  const msg: WorkerResponse = { id, type: 'ok', data };
  (self as unknown as Worker).postMessage(msg, transfer);
}
