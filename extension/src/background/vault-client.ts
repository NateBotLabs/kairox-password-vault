/**
 * ExtensionVaultClient — orchestrates the WASM session, the HTTP API, and an
 * in-memory entry cache for the background service worker.
 *
 * Mirrors the shape of VaultClient in @kairox/sdk but without VaultSession
 * (Web Workers are unavailable in MV3 service workers). Crypto calls are
 * synchronous here because the service worker doesn't block a UI thread.
 */

import { createApiClient, type ApiClient } from '$sdk/api';
import { decodeEntry, encodeEntry, fromBase64, newId, nowSecs, toBase64, uuidToBytes } from '$sdk/utils';
import type { CollectionDto, VaultEntry } from '$sdk/types';
import * as session from './session.js';
import { matchesOrigin } from '../shared/origin.js';
import type { AutofillCandidate, AutofillCredentials } from '../shared/messages.js';

const CACHE_TTL_MS = 30_000;

interface CacheEntry {
  entries: VaultEntry[];
  fetched: number;
}

export class ExtensionVaultClient {
  private api: ApiClient;
  token: string | null = null;  // public for SW restart recovery
  private readonly cache = new Map<string, CacheEntry>();

  constructor(baseUrl: string) {
    this.api = createApiClient(baseUrl, () => this.token);
  }

  updateBaseUrl(baseUrl: string): void {
    this.api = createApiClient(baseUrl, () => this.token);
  }

  get isLocked(): boolean       { return !session.isUnlocked(); }
  get isAuthenticated(): boolean { return this.token !== null; }

  // ── Auth ───────────────────────────────────────────────────────────────────

  async register(email: string, password: string): Promise<void> {
    const salt = await session.generateSalt();
    const { authKey, publicKey } = await session.unlock(password, salt);

    const resp = await this.api.auth.register({
      email,
      auth_key:   toBase64(authKey),
      public_key: toBase64(publicKey),
      salt:       toBase64(salt),
    });

    this.token = resp.token;
  }

  async login(email: string, password: string): Promise<void> {
    const { salt: saltB64 } = await this.api.auth.getSalt(email);
    const salt = fromBase64(saltB64);
    const { authKey } = await session.unlock(password, salt);

    const resp = await this.api.auth.login({
      email,
      auth_key: toBase64(authKey),
    });

    this.token = resp.token;
  }

  lock(): void {
    session.lock();
    this.token = null;
    this.cache.clear();
  }

  // ── Collections ────────────────────────────────────────────────────────────

  async listCollections(): Promise<CollectionDto[]> {
    this.assertUnlocked();
    return this.api.collections.list();
  }

  async createCollection(): Promise<CollectionDto> {
    this.assertUnlocked();

    const collectionKey = await session.generateCollectionKey();
    const me            = await this.api.users.me();
    const myPublicKey   = fromBase64(me.public_key);
    const tempAad       = new Uint8Array(16);
    const wrappedKey    = session.wrapKeyFor(myPublicKey, collectionKey, tempAad);

    const collection = await this.api.collections.create({ wrapped_key: toBase64(wrappedKey) });

    const realAad          = uuidToBytes(collection.id);
    const properWrappedKey = session.wrapKeyFor(myPublicKey, collectionKey, realAad);
    await this.api.collections.addWrappedKey(collection.id, {
      user_id:     me.id,
      key_version: 1,
      wrapped_key: toBase64(properWrappedKey),
    });

    return collection;
  }

  // ── Entries ────────────────────────────────────────────────────────────────

  async listEntries(collectionId: string): Promise<VaultEntry[]> {
    this.assertUnlocked();

    const cached = this.cache.get(collectionId);
    if (cached && Date.now() - cached.fetched < CACHE_TTL_MS) return cached.entries;

    const ck   = await this.getCollectionKey(collectionId);
    const dtos = await this.api.entries.list(collectionId);

    const entries = dtos.map(dto => {
      const ciphertext = fromBase64(dto.ciphertext);
      const aad        = uuidToBytes(dto.id);
      const plaintext  = session.decryptWithKey(ck, ciphertext, aad);
      return decodeEntry<VaultEntry>(plaintext);
    });

    this.cache.set(collectionId, { entries, fetched: Date.now() });
    return entries;
  }

  async createEntry(collectionId: string, kind: VaultEntry['kind']): Promise<VaultEntry> {
    this.assertUnlocked();

    const ck    = await this.getCollectionKey(collectionId);
    const entry: VaultEntry = {
      id:         newId(),
      version:    1,
      created_at: nowSecs(),
      updated_at: nowSecs(),
      kind,
    };

    const plaintext  = encodeEntry(entry);
    const aad        = uuidToBytes(entry.id);
    const ciphertext = session.encryptWithKey(ck, plaintext, aad);

    await this.api.entries.create({
      collection_id: collectionId,
      ciphertext:    toBase64(ciphertext),
    });

    this.cache.delete(collectionId);
    return entry;
  }

  async deleteEntry(entryId: string, collectionId: string): Promise<void> {
    this.assertUnlocked();
    await this.api.entries.delete(entryId);
    this.cache.delete(collectionId);  // bust cache so next listEntries is fresh
  }

  // ── Autofill ───────────────────────────────────────────────────────────────

  /**
   * Find all Login entries whose URL matches `pageUrl`.
   * Returns lightweight candidates (no passwords).
   */
  async findCandidatesForUrl(pageUrl: string): Promise<AutofillCandidate[]> {
    this.assertUnlocked();
    const collections = await this.api.collections.list();
    const candidates: AutofillCandidate[] = [];

    for (const col of collections) {
      let entries: VaultEntry[];
      try {
        entries = await this.listEntries(col.id);
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!('Login' in entry.kind)) continue;
        const login = entry.kind.Login;
        if (matchesOrigin(pageUrl, login.url)) {
          candidates.push({
            id:           entry.id,
            collectionId: col.id,
            name:         login.name,
            username:     login.username,
            url:          login.url,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Decrypt and return credentials for a specific entry.
   * Only called after origin re-validation by the message handler.
   */
  async getCredentials(entryId: string, collectionId: string): Promise<AutofillCredentials> {
    this.assertUnlocked();

    const ck  = await this.getCollectionKey(collectionId);
    const dto = await this.api.entries.get(entryId);

    const ciphertext = fromBase64(dto.ciphertext);
    const aad        = uuidToBytes(dto.id);
    const plaintext  = session.decryptWithKey(ck, ciphertext, aad);
    const entry      = decodeEntry<VaultEntry>(plaintext);

    if (!('Login' in entry.kind)) throw new Error('Not a login entry');
    const login = entry.kind.Login;

    return {
      username: login.username,
      password: login.password,
      totp:     login.totp_secret ?? undefined,
    };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private assertUnlocked(): void {
    if (this.isLocked || !this.isAuthenticated) {
      throw new Error('Vault is locked');
    }
  }

  private async getCollectionKey(collectionId: string): Promise<Uint8Array> {
    const wkDto  = await this.api.collections.getWrappedKey(collectionId);
    const wrapped = fromBase64(wkDto.wrapped_key);
    const aad    = uuidToBytes(collectionId);
    return session.unwrapKey(wrapped, aad);
  }
}
