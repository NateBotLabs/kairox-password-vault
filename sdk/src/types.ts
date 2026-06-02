// ── Vault entry types ─────────────────────────────────────────────────────────
// These mirror kairox-types in Rust. Entries are serialized to JSON, encrypted
// with XChaCha20-Poly1305, and stored opaquely on the server.

export interface VaultEntry {
  /** 16-byte UUID as hex string (e.g. "550e8400e29b41d4a716446655440000") */
  id: string;
  version: number;
  created_at: number;   // Unix epoch seconds
  updated_at: number;
  kind: EntryKind;
}

export type EntryKind =
  | { Login: LoginEntry }
  | { SecureNote: SecureNote }
  | { CreditCard: CreditCard };

export interface LoginEntry {
  name: string;
  username: string;
  password: string;
  url?: string;
  totp_secret?: string;
  notes?: string;
  custom_fields: CustomField[];
}

export interface SecureNote {
  title: string;
  content: string;
}

export interface CreditCard {
  name: string;
  number: string;
  expiry_month: number;
  expiry_year: number;
  cvv: string;
  cardholder: string;
  notes?: string;
}

export interface CustomField {
  name: string;
  value: string;
  hidden: boolean;
}

// ── API response shapes ───────────────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  user_id: string;
}

export interface UserDto {
  id: string;
  email: string;
  public_key: string;   // base64
  created_at: string;   // ISO 8601
}

export interface CollectionDto {
  id: string;
  owner_id: string;
  created_at: string;
}

export interface WrappedKeyDto {
  collection_id: string;
  user_id: string;
  key_version: number;
  wrapped_key: string;  // base64
}

export interface EntryDto {
  id: string;
  collection_id: string;
  version: number;
  created_at: string;
  updated_at: string;
  ciphertext: string;   // base64
}

// ── Session state ─────────────────────────────────────────────────────────────

export interface UnlockResult {
  authKey: Uint8Array;
  publicKey: Uint8Array;
}

// ── Worker message protocol ───────────────────────────────────────────────────

export type WorkerRequest =
  | { id: string; type: 'derive';              password: Uint8Array; salt: Uint8Array }
  | { id: string; type: 'encrypt';             plaintext: Uint8Array; aad: Uint8Array }
  | { id: string; type: 'decrypt';             ciphertext: Uint8Array; aad: Uint8Array }
  | { id: string; type: 'encrypt_with_key';    key: Uint8Array; plaintext: Uint8Array; aad: Uint8Array }
  | { id: string; type: 'decrypt_with_key';    key: Uint8Array; ciphertext: Uint8Array; aad: Uint8Array }
  | { id: string; type: 'wrap_key_for';        recipient_public: Uint8Array; key_material: Uint8Array; aad: Uint8Array }
  | { id: string; type: 'unwrap_key';          wrapped: Uint8Array; aad: Uint8Array }
  | { id: string; type: 'generate_collection_key' }
  | { id: string; type: 'generate_salt' }
  | { id: string; type: 'lock' };

export type WorkerResponse =
  | { id: string; type: 'ok';    data: unknown }
  | { id: string; type: 'error'; message: string };
