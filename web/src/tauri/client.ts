/**
 * TauriVaultClient
 *
 * Replaces the WASM-based VaultClient when running inside the Tauri desktop app.
 * All cryptographic operations are delegated to the Rust backend via `invoke`.
 *
 * Security advantage over the browser version:
 *   - The Argon2id KDF runs natively (2–3× faster, no WASM overhead).
 *   - ALL key material (master key, symmetric key, identity keypair,
 *     collection keys) lives exclusively in the Rust process and is
 *     NEVER transferred to the WebView.
 *   - On lock, Rust drops the session struct, triggering ZeroizeOnDrop
 *     on every key field.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { createApiClient, type ApiClient } from '@kairox/sdk';
import type { CollectionDto, EntryDto, VaultEntry } from '@kairox/sdk';
import { decodeEntry, encodeEntry, fromBase64, newId, nowSecs, toBase64, uuidToBytes } from '@kairox/sdk';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function kx<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

// ── Client ────────────────────────────────────────────────────────────────────

export class TauriVaultClient {
  private token: string | null = null;
  private readonly api: ApiClient;

  constructor(readonly baseUrl: string) {
    this.api = createApiClient(baseUrl, () => this.token);
  }

  get isLocked(): boolean { return this.token === null; }
  get isAuthenticated(): boolean { return this.token !== null; }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Create a new account. KDF runs natively in Rust — no blocking the UI.
   * Keys are never returned to JavaScript.
   */
  async register(email: string, password: string): Promise<void> {
    // 1. Generate a fresh Argon2 salt in Rust
    const salt: number[] = await kx('kx_generate_salt');
    const saltBytes = new Uint8Array(salt);

    // 2. Derive all keys; Rust stores the session, returns only auth + public key
    const { auth_key, public_key }: { auth_key: string; public_key: string } =
      await kx('kx_derive', {
        password: Array.from(new TextEncoder().encode(password)),
        salt,
      });

    // 3. Register with server
    const resp = await this.api.auth.register({
      email,
      auth_key,
      public_key,
      salt: toBase64(saltBytes),
    });

    this.token = resp.token;
  }

  /** Unlock an existing account. */
  async login(email: string, password: string): Promise<void> {
    const { salt: saltB64 } = await this.api.auth.getSalt(email);
    const salt = fromBase64(saltB64);

    const { auth_key }: { auth_key: string } = await kx('kx_derive', {
      password: Array.from(new TextEncoder().encode(password)),
      salt: Array.from(salt),
    });

    const resp = await this.api.auth.login({ email, auth_key });
    this.token = resp.token;
  }

  /** Zeroize all key material in the Rust backend, clear the auth token. */
  async lock(): Promise<void> {
    await kx('kx_lock').catch(() => {});
    this.token = null;
  }

  /**
   * Listen for the system-tray "Lock" action and invoke the given callback.
   * Returns an unlisten function.
   */
  onTrayLock(cb: () => void) {
    return listen('kairox://lock', cb);
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async listCollections(): Promise<CollectionDto[]> {
    return this.api.collections.list();
  }

  /**
   * Create a new collection.
   * The client pre-generates the UUID so it can be used as AAD when wrapping
   * the Collection Key — the wrapped key is cryptographically bound to this
   * collection ID before it ever reaches the server.
   */
  async createCollection(): Promise<CollectionDto> {
    const collectionId = newId();
    const aad = uuidToBytes(collectionId);

    // Generate CK in Rust, store it, wrap for self, return wrapped bytes
    const wrappedKey: string = await kx('kx_generate_collection_key', {
      collectionId,
      aad: Array.from(aad),
    });

    return this.api.collections.create({
      collection_id: collectionId,
      wrapped_key: wrappedKey,
    } as Parameters<ApiClient['collections']['create']>[0] & { collection_id: string });
  }

  async grantAccess(collectionId: string, userId: string): Promise<void> {
    // Ensure the CK is loaded in Rust state
    await this.ensureCollectionKey(collectionId);

    const { public_key: pkB64 } = await this.api.users.publicKey(userId);

    const wrappedKey: string = await kx('kx_wrap_collection_key_for', {
      collectionId,
      recipientPublicB64: pkB64,
    });

    const me = await this.api.users.me();
    await this.api.collections.addWrappedKey(collectionId, {
      user_id: me.id,
      key_version: 1,
      wrapped_key: wrappedKey,
    });
  }

  async revokeAccess(collectionId: string, userId: string): Promise<void> {
    await this.api.collections.revokeAccess(collectionId, userId);
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  async listEntries(collectionId: string): Promise<VaultEntry[]> {
    await this.ensureCollectionKey(collectionId);
    const dtos = await this.api.entries.list(collectionId);
    return Promise.all(dtos.map(dto => this.decryptDto(collectionId, dto)));
  }

  async createEntry(collectionId: string, kind: VaultEntry['kind']): Promise<VaultEntry> {
    await this.ensureCollectionKey(collectionId);

    const entry: VaultEntry = {
      id:         newId(),
      version:    1,
      created_at: nowSecs(),
      updated_at: nowSecs(),
      kind,
    };

    const plaintext = encodeEntry(entry);
    const aad = uuidToBytes(entry.id);

    const ciphertext: number[] = await kx('kx_encrypt_entry', {
      collectionId,
      plaintext: Array.from(plaintext),
      aad: Array.from(aad),
    });

    await this.api.entries.create({
      collection_id: collectionId,
      ciphertext: toBase64(new Uint8Array(ciphertext)),
    });

    return entry;
  }

  async updateEntry(
    collectionId: string,
    entryId: string,
    kind: VaultEntry['kind'],
    currentVersion: number,
  ): Promise<VaultEntry> {
    await this.ensureCollectionKey(collectionId);

    const dto = await this.api.entries.get(entryId);
    const entry: VaultEntry = {
      id:         entryId,
      version:    currentVersion + 1,
      created_at: Math.floor(new Date(dto.created_at).getTime() / 1000),
      updated_at: nowSecs(),
      kind,
    };

    const plaintext = encodeEntry(entry);
    const aad = uuidToBytes(entryId);

    const ciphertext: number[] = await kx('kx_encrypt_entry', {
      collectionId,
      plaintext: Array.from(plaintext),
      aad: Array.from(aad),
    });

    await this.api.entries.update(entryId, {
      ciphertext: toBase64(new Uint8Array(ciphertext)),
      expected_version: currentVersion,
    });

    return entry;
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.api.entries.delete(entryId);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async ensureCollectionKey(collectionId: string): Promise<void> {
    // Ask Rust to load the CK if it isn't already in state.
    // kx_load_collection_key is idempotent — safe to call multiple times.
    const wkDto = await this.api.collections.getWrappedKey(collectionId);
    await kx('kx_load_collection_key', {
      collectionId,
      wrappedB64: wkDto.wrapped_key,
    });
  }

  private async decryptDto(collectionId: string, dto: EntryDto): Promise<VaultEntry> {
    const ciphertext = fromBase64(dto.ciphertext);
    const aad = uuidToBytes(dto.id);

    const plaintext: number[] = await kx('kx_decrypt_entry', {
      collectionId,
      ciphertext: Array.from(ciphertext),
      aad: Array.from(aad),
    });

    return decodeEntry<VaultEntry>(new Uint8Array(plaintext));
  }
}
