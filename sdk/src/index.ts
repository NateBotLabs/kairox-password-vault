// Public SDK exports

export { VaultClient }                        from './client.js';
export type { VaultClientOptions }            from './client.js';
export { VaultSession }                       from './session.js';
export { ApiError, createApiClient }          from './api.js';
export type { ApiClient }                     from './api.js';
export type {
  VaultEntry,
  EntryKind,
  LoginEntry,
  SecureNote,
  CreditCard,
  CustomField,
  CollectionDto,
  EntryDto,
  UserDto,
  WrappedKeyDto,
  AuthResponse,
} from './types.js';
export { toBase64, fromBase64, newId, uuidToBytes, nowSecs, encodeEntry, decodeEntry } from './utils.js';
