use rand::{rngs::OsRng, RngCore};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub const COLLECTION_KEY_LEN: usize = 32;

/// A 32-byte symmetric key used to encrypt all entries in a collection.
///
/// Distributed to authorized users via `keywrap::wrap_key`. Never sent to
/// the server in plaintext.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct CollectionKey([u8; COLLECTION_KEY_LEN]);

impl CollectionKey {
    pub fn generate() -> Self {
        let mut key = [0u8; COLLECTION_KEY_LEN];
        OsRng.fill_bytes(&mut key);
        CollectionKey(key)
    }

    pub fn from_bytes(bytes: [u8; COLLECTION_KEY_LEN]) -> Self {
        CollectionKey(bytes)
    }

    /// Recover from raw bytes returned by `keywrap::unwrap_key`.
    pub fn from_slice(bytes: &[u8]) -> Option<Self> {
        let arr: [u8; COLLECTION_KEY_LEN] = bytes.try_into().ok()?;
        Some(CollectionKey(arr))
    }

    pub fn as_bytes(&self) -> &[u8; COLLECTION_KEY_LEN] {
        &self.0
    }

    /// Export to a zeroizing buffer (e.g. to pass into `keywrap::wrap_key`).
    pub fn to_zeroizing(&self) -> Zeroizing<[u8; COLLECTION_KEY_LEN]> {
        Zeroizing::new(self.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_are_unique() {
        let k1 = CollectionKey::generate();
        let k2 = CollectionKey::generate();
        assert_ne!(k1.as_bytes(), k2.as_bytes());
    }

    #[test]
    fn round_trip_via_slice() {
        let ck = CollectionKey::generate();
        let bytes = *ck.as_bytes();
        let recovered = CollectionKey::from_slice(&bytes).unwrap();
        assert_eq!(ck.as_bytes(), recovered.as_bytes());
    }

    #[test]
    fn from_slice_wrong_length_returns_none() {
        assert!(CollectionKey::from_slice(&[0u8; 16]).is_none());
        assert!(CollectionKey::from_slice(&[]).is_none());
    }
}
