use argon2::{Argon2, Algorithm, Version, Params};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};
use crate::error::CryptoError;

pub const MASTER_KEY_LEN: usize = 32;

#[derive(Zeroize, ZeroizeOnDrop)]
pub struct MasterKey([u8; MASTER_KEY_LEN]);

impl MasterKey {
    pub fn derive(password: &[u8], salt: &[u8]) -> Result<Self, CryptoError> {
        let params = Params::new(65536, 3, 4, Some(MASTER_KEY_LEN))?;
        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
        let mut key = [0u8; MASTER_KEY_LEN];
        argon2.hash_password_into(password, salt, &mut key)?;
        Ok(MasterKey(key))
    }

    // Derive a subkey — NEVER use master key directly
    pub fn derive_subkey(&self, info: &[u8]) -> Zeroizing<[u8; 32]> {
        let hkdf = Hkdf::<Sha256>::new(None, &self.0);
        let mut okm = Zeroizing::new([0u8; 32]);
        hkdf.expand(info, okm.as_mut()).expect("HKDF expand failed");
        okm
    }

    pub fn symmetric_key(&self) -> Zeroizing<[u8; 32]> {
        self.derive_subkey(b"kairox-symmetric-v1")
    }

    pub fn auth_key(&self) -> Zeroizing<[u8; 32]> {
        self.derive_subkey(b"kairox-auth-v1")
    }

    /// Seed for the user's long-term X25519 identity keypair.
    /// Pass to `UserKeyPair::from_seed` — never use these bytes directly.
    pub fn identity_key(&self) -> Zeroizing<[u8; 32]> {
        self.derive_subkey(b"kairox-identity-v1")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_is_deterministic() {
        let password = b"hunter2";
        let salt = b"12345678901234567890123456789012"; // 32 bytes
        let k1 = MasterKey::derive(password, salt).unwrap();
        let k2 = MasterKey::derive(password, salt).unwrap();
        assert_eq!(k1.symmetric_key(), k2.symmetric_key());
    }

    #[test]
    fn subkeys_are_distinct() {
        let mk = MasterKey::derive(b"password", &[0u8; 32]).unwrap();
        assert_ne!(mk.symmetric_key(), mk.auth_key());
    }
}