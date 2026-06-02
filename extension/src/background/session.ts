/**
 * ExtensionVaultSession — runs the kairox-crypto WASM module directly in the
 * MV3 service worker. No nested Worker is possible in this context.
 *
 * The service worker itself is the trust boundary: content scripts and the
 * popup never have access to the KairoxVault instance or its key material.
 *
 * The WASM file is loaded from public/wasm/kairox_crypto_bg.wasm, which is
 * copied from crates/kairox-crypto/pkg/ at build time.
 */

/// <reference types="chrome" />

import init, {
  KairoxVault,
  generate_collection_key,
  generate_salt,
} from 'kairox-crypto-wasm';

let wasmReady = false;
let vault: KairoxVault | null = null;

async function ensureWasm(): Promise<void> {
  if (wasmReady) return;
  // Fetch the WASM binary from the extension package.
  // chrome.runtime.getURL works in all extension contexts without WAR declarations.
  const wasmUrl = chrome.runtime.getURL('wasm/kairox_crypto_bg.wasm');
  await init(fetch(wasmUrl));
  wasmReady = true;
}

export function isUnlocked(): boolean {
  return vault !== null;
}

export function requireVault(): KairoxVault {
  if (!vault) throw new Error('Vault is locked');
  return vault;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

/**
 * Derive all keys from password + salt.
 * Returns the non-secret authKey (for server authentication) and publicKey.
 * All other key material stays inside the KairoxVault instance.
 */
export async function unlock(
  password: string,
  salt: Uint8Array,
): Promise<{ authKey: Uint8Array; publicKey: Uint8Array }> {
  await ensureWasm();

  if (vault) { vault.free(); vault = null; }

  const passwordBytes = new TextEncoder().encode(password);
  vault = new KairoxVault(passwordBytes, salt);

  return {
    authKey:   vault.auth_key(),
    publicKey: vault.public_key(),
  };
}

/** Zeroize key material and drop the WASM instance. */
export function lock(): void {
  if (vault) { vault.free(); vault = null; }
}

// ── Crypto operations (proxy to vault) ────────────────────────────────────────

export function encryptWithKey(key: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Uint8Array {
  return requireVault().encrypt_with_key(key, plaintext, aad);
}

export function decryptWithKey(key: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Uint8Array {
  return requireVault().decrypt_with_key(key, ciphertext, aad);
}

export function wrapKeyFor(
  recipientPublic: Uint8Array,
  keyMaterial: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return requireVault().wrap_key_for(recipientPublic, keyMaterial, aad);
}

export function unwrapKey(wrapped: Uint8Array, aad: Uint8Array): Uint8Array {
  return requireVault().unwrap_key(wrapped, aad);
}

export async function generateCollectionKey(): Promise<Uint8Array> {
  await ensureWasm();
  return generate_collection_key();
}

export async function generateSalt(): Promise<Uint8Array> {
  await ensureWasm();
  return generate_salt();
}
