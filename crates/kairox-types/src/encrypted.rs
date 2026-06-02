use serde::{Deserialize, Serialize};

/// An encrypted vault entry as stored on / returned from the server.
///
/// `ciphertext` = `aead::encrypt(collection_key, entry.to_cbor(), &id)`
/// The entry `id` is used as AAD so the ciphertext is cryptographically
/// bound to this specific entry — transplanting it elsewhere will fail auth.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedEntry {
    pub id: [u8; 16],
    pub collection_id: [u8; 16],
    /// Monotonically increasing; used for optimistic concurrency and sync.
    pub version: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub ciphertext: Vec<u8>,
}

/// A Collection Key wrapped (encrypted) for one specific user.
///
/// `wrapped_bytes` = `keywrap::wrap_key(user_public, collection_key, &collection_id)`
/// The `collection_id` is used as AAD to prevent transplanting a wrapped key
/// across collections.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub collection_id: [u8; 16],
    pub user_id: [u8; 16],
    /// Tracks Collection Key rotation. Increment when the CK is rotated.
    pub key_version: u32,
    pub wrapped_bytes: Vec<u8>,
}
