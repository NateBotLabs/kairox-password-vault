/**
 * VaultClient — high-level API.
 *
 * Combines the VaultSession (crypto worker) and the HTTP ApiClient so callers
 * never have to touch base64, key bytes, or AAD directly.
 *
 * Security properties:
 *   - All key material lives only in the Web Worker (VaultSession).
 *   - The server receives only ciphertext, wrapped keys, and auth tokens.
 *   - Collection Key access is purely cryptographic: possession of the
 *     wrapped key is the only gate; the server enforces nothing.
 */

import { ApiClient, createApiClient } from './api.js';
import { VaultSession } from './session.js';
import type { CollectionDto, EntryDto, VaultEntry } from './types.js';
import { decodeEntry, encodeEntry, fromBase64, newId, nowSecs, toBase64, uuidToBytes } from './utils.js';

export interface VaultClientOptions {
  /** Base URL of the kairox-api server, e.g. "https://vault.example.com" */
  baseUrl: string;
}

export class VaultClient {
  private session: VaultSession | null = null;
  private token: string | null = null;
  private api: ApiClient;

  constructor(private readonly options: VaultClientOptions) {
    this.api = createApiClient(options.baseUrl, () => this.token);
  }

  get isLocked(): boolean { return this.session === null; }
  get isAuthenticated(): boolean { return this.token !== null; }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Create a new account.
   * - Generates a random Argon2 salt.
   * - Derives all keys client-side (Argon2id, 64 MiB).
   * - Sends only `auth_key` (hash-of-hash), `public_key`, and `salt` to the server.
   */
  async register(email: string, password: string): Promise<void> {
    const session = new VaultSession();

    const salt = await session.generateSalt();
    const { authKey, publicKey } = await session.unlock(password, salt);

    const resp = await this.api.auth.register({
      email,
      auth_key:   toBase64(authKey),
      public_key: toBase64(publicKey),
      salt:       toBase64(salt),
    });

    this.session = session;
    this.token = resp.token;
  }

  /**
   * Unlock an existing account.
   * - Fetches the stored Argon2 salt from the server.
   * - Derives keys locally, then authenticates.
   */
  async login(email: string, password: string): Promise<void> {
    const { salt: saltB64 } = await this.api.auth.getSalt(email);
    const salt = fromBase64(saltB64);

    const session = new VaultSession();
    const { authKey } = await session.unlock(password, salt);

    const resp = await this.api.auth.login({
      email,
      auth_key: toBase64(authKey),
    });

    this.session = session;
    this.token = resp.token;
  }

  /**
   * Zeroize all key material (triggers Rust `drop` + `zeroize` in the worker),
   * terminate the worker thread, and clear the auth token.
   */
  async lock(): Promise<void> {
    if (this.session) {
      await this.session.lock();
      this.session = null;
    }
    this.token = null;
  }

  // ── Collections ───────────────────────────────────────────────────────────

  async listCollections(): Promise<CollectionDto[]> {
    this.assertUnlocked();
    return this.api.collections.list();
  }

  /**
   * Create a new collection.
   * Generates a random Collection Key, wraps it for the current user,
   * and stores both on the server atomically.
   */
  async createCollection(): Promise<CollectionDto> {
    const session = this.assertUnlocked();

    // Generate a random 32-byte Collection Key inside the worker
    const collectionKey = await session.generateCollectionKey();

    // We need our own public key to wrap the CK for ourselves.
    // Derive a fresh unlock result isn't possible (we'd need the password again),
    // so we fetch our public key from the server.
    const me = await this.api.users.me();
    const myPublicKey = fromBase64(me.public_key);

    // Wrap the CK for ourselves — we'll use a placeholder collection ID as AAD
    // because we don't know the real ID yet. The server assigns it.
    // We re-wrap with the real ID after creation (see note below).
    //
    // Note: For the MVP, we use a zero-filled 16-byte AAD here and re-wrap
    // after learning the real collection ID. A production implementation
    // would use a client-generated UUID submitted with the creation request.
    const tempAad = new Uint8Array(16);
    const wrappedKey = await session.wrapKeyFor(myPublicKey, collectionKey, tempAad);

    const collection = await this.api.collections.create({
      wrapped_key: toBase64(wrappedKey),
    });

    // Re-wrap using the real collection ID as AAD (prevents ciphertext transplant)
    const realAad = uuidToBytes(collection.id);
    const properWrappedKey = await session.wrapKeyFor(myPublicKey, collectionKey, realAad);
    await this.api.collections.addWrappedKey(collection.id, {
      user_id:     me.id,
      key_version: 1,
      wrapped_key: toBase64(properWrappedKey),
    });

    return collection;
  }

  /**
   * Grant another user access to a collection (owner only).
   * Fetches the other user's public key from the server and wraps the
   * Collection Key for them — the server never sees the plaintext CK.
   */
  async grantAccess(collectionId: string, userId: string): Promise<void> {
    const session = this.assertUnlocked();

    // Recover our wrapped CK and unwrap it
    const ck = await this.getCollectionKey(collectionId);

    // Fetch the target user's public key
    const { public_key: pkB64 } = await this.api.users.publicKey(userId);
    const recipientPublic = fromBase64(pkB64);

    const aad = uuidToBytes(collectionId);
    const wrappedForThem = await session.wrapKeyFor(recipientPublic, ck, aad);

    await this.api.collections.addWrappedKey(collectionId, {
      user_id:     userId,
      key_version: 1,
      wrapped_key: toBase64(wrappedForThem),
    });
  }

  async revokeAccess(collectionId: string, userId: string): Promise<void> {
    this.assertUnlocked();
    await this.api.collections.revokeAccess(collectionId, userId);
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  /**
   * List and decrypt all entries in a collection.
   * The Collection Key is unwrapped locally; the server only serves ciphertext.
   */
  async listEntries(collectionId: string): Promise<VaultEntry[]> {
    const session = this.assertUnlocked();
    const ck      = await this.getCollectionKey(collectionId);
    const dtos    = await this.api.entries.list(collectionId);

    return Promise.all(dtos.map(dto => this.decryptEntry(session, ck, dto)));
  }

  /**
   * Encrypt and upload a new vault entry.
   * The entry `id` is used as AAD — the ciphertext is bound to this entry ID.
   */
  async createEntry(
    collectionId: string,
    kind: VaultEntry['kind'],
  ): Promise<VaultEntry> {
    const session = this.assertUnlocked();
    const ck      = await this.getCollectionKey(collectionId);

    const entry: VaultEntry = {
      id:         newId(),
      version:    1,
      created_at: nowSecs(),
      updated_at: nowSecs(),
      kind,
    };

    const plaintext = encodeEntry(entry);
    const aad       = uuidToBytes(entry.id);
    const ciphertext = await session.encryptWithKey(ck, plaintext, aad);

    await this.api.entries.create({
      collection_id: collectionId,
      ciphertext:    toBase64(ciphertext),
    });

    return entry;
  }

  /**
   * Update an existing entry with new content.
   * Uses optimistic concurrency — provide the current `version` to detect
   * conflicts on the server.
   */
  async updateEntry(
    collectionId: string,
    entryId: string,
    kind: VaultEntry['kind'],
    currentVersion: number,
  ): Promise<VaultEntry> {
    const session = this.assertUnlocked();
    const ck      = await this.getCollectionKey(collectionId);

    const dto = await this.api.entries.get(entryId);

    const entry: VaultEntry = {
      id:         entryId,
      version:    currentVersion + 1,
      created_at: Math.floor(new Date(dto.created_at).getTime() / 1000),
      updated_at: nowSecs(),
      kind,
    };

    const plaintext  = encodeEntry(entry);
    const aad        = uuidToBytes(entry.id);
    const ciphertext = await session.encryptWithKey(ck, plaintext, aad);

    await this.api.entries.update(entryId, {
      ciphertext:       toBase64(ciphertext),
      expected_version: currentVersion,
    });

    return entry;
  }

  async deleteEntry(entryId: string): Promise<void> {
    this.assertUnlocked();
    await this.api.entries.delete(entryId);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private assertUnlocked(): VaultSession {
    if (!this.session) throw new Error('Vault is locked — call login() or register() first');
    return this.session;
  }

  private async getCollectionKey(collectionId: string): Promise<Uint8Array> {
    const session = this.assertUnlocked();
    const wkDto   = await this.api.collections.getWrappedKey(collectionId);
    const wrapped = fromBase64(wkDto.wrapped_key);
    const aad     = uuidToBytes(collectionId);
    return session.unwrapKey(wrapped, aad);
  }

  private async decryptEntry(
    session: VaultSession,
    ck: Uint8Array,
    dto: EntryDto,
  ): Promise<VaultEntry> {
    const ciphertext = fromBase64(dto.ciphertext);
    const aad        = uuidToBytes(dto.id);
    const plaintext  = await session.decryptWithKey(ck, ciphertext, aad);
    return decodeEntry<VaultEntry>(plaintext);
  }
}
