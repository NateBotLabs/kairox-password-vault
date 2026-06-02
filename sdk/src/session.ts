/**
 * VaultSession — main-thread proxy to the crypto Web Worker.
 *
 * All key material stays in the worker; the main thread only ever sees
 * ciphertext, wrapped keys, and the non-secret auth/public keys returned
 * from `unlock()`.
 *
 * Binary data is transferred zero-copy via Transferable ArrayBuffers.
 */

import type { UnlockResult, WorkerRequest, WorkerResponse } from './types.js';

type Resolver = { resolve: (v: unknown) => void; reject: (e: Error) => void };

// Omit<A | B, 'id'> only keeps keys shared by ALL members, losing payload fields.
// DistributiveOmit uses a bare generic parameter so the conditional distributes
// over each union member independently.
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type Msg = DistributiveOmit<WorkerRequest, 'id'>;

export class VaultSession {
  private readonly worker: Worker;
  private readonly pending = new Map<string, Resolver>();
  private counter = 0;
  private locked = false;

  constructor() {
    // Bundlers (Vite, Webpack 5) inline the worker when using this pattern
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data.data);
    };

    this.worker.onerror = (e) => {
      // Reject all outstanding requests on unhandled worker error
      const err = new Error(e.message ?? 'Worker error');
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    };
  }

  // ── Core ──────────────────────────────────────────────────────────────────

  private send<T>(msg: Msg, transfer: Transferable[] = []): Promise<T> {
    if (this.locked) return Promise.reject(new Error('Session is locked'));
    const id = String(this.counter++);
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, ...msg }, transfer);
    });
  }

  // ── KDF (slow — runs Argon2id in the worker, never blocks the UI) ─────────

  /**
   * Derive all keys from `password` and `salt`.
   * Returns `{ authKey, publicKey }` — the only values that need to leave
   * the worker for registration / login. The symmetric and identity keys
   * remain isolated inside the worker.
   */
  async unlock(password: string, salt: Uint8Array): Promise<UnlockResult> {
    const passwordBytes = new TextEncoder().encode(password);
    const saltCopy = salt.slice();  // don't transfer the caller's buffer
    return this.send<UnlockResult>(
      { type: 'derive', password: passwordBytes, salt: saltCopy },
      [passwordBytes.buffer, saltCopy.buffer],
    );
  }

  // ── Symmetric encryption (personal vault key) ─────────────────────────────

  async encrypt(plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const pt = plaintext.slice();
    return this.send<Uint8Array>({ type: 'encrypt', plaintext: pt, aad }, [pt.buffer]);
  }

  async decrypt(ciphertext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const ct = ciphertext.slice();
    return this.send<Uint8Array>({ type: 'decrypt', ciphertext: ct, aad }, [ct.buffer]);
  }

  // ── Collection-key encryption (shared vaults) ─────────────────────────────

  async encryptWithKey(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const k = key.slice(), pt = plaintext.slice();
    return this.send<Uint8Array>(
      { type: 'encrypt_with_key', key: k, plaintext: pt, aad },
      [k.buffer, pt.buffer],
    );
  }

  async decryptWithKey(key: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const k = key.slice(), ct = ciphertext.slice();
    return this.send<Uint8Array>(
      { type: 'decrypt_with_key', key: k, ciphertext: ct, aad },
      [k.buffer, ct.buffer],
    );
  }

  // ── Key wrapping (grant / receive collection access) ──────────────────────

  /**
   * Wrap `keyMaterial` for a recipient's X25519 public key.
   * `aad` should be the collection UUID bytes.
   */
  async wrapKeyFor(
    recipientPublic: Uint8Array,
    keyMaterial: Uint8Array,
    aad: Uint8Array,
  ): Promise<Uint8Array> {
    const rp = recipientPublic.slice(), km = keyMaterial.slice();
    return this.send<Uint8Array>(
      { type: 'wrap_key_for', recipient_public: rp, key_material: km, aad },
      [rp.buffer, km.buffer],
    );
  }

  /** Unwrap a Collection Key that was wrapped for this session's identity key. */
  async unwrapKey(wrapped: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
    const w = wrapped.slice();
    return this.send<Uint8Array>({ type: 'unwrap_key', wrapped: w, aad }, [w.buffer]);
  }

  // ── Key generation ────────────────────────────────────────────────────────

  async generateCollectionKey(): Promise<Uint8Array> {
    return this.send<Uint8Array>({ type: 'generate_collection_key' });
  }

  async generateSalt(): Promise<Uint8Array> {
    return this.send<Uint8Array>({ type: 'generate_salt' });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Zeroize key material inside the worker (triggers Rust `Drop` + `zeroize`),
   * then terminate the worker thread.
   */
  async lock(): Promise<void> {
    this.locked = true;
    try {
      await this.send<null>({ type: 'lock' });
    } finally {
      this.worker.terminate();
    }
  }
}
