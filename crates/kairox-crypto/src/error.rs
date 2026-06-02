use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key derivation failed: {0}")]
    Kdf(String),

    #[error("encryption failed")]
    Encrypt,

    #[error("decryption failed (wrong key or corrupted data)")]
    Decrypt,

    #[error("invalid key length: expected {expected}, got {got}")]
    InvalidKeyLength { expected: usize, got: usize },

    #[error("invalid nonce length")]
    InvalidNonce,

    #[error("unsupported payload version: {0}")]
    UnsupportedVersion(u8),

    #[error("serialization failed: {0}")]
    Serialize(String),
}

impl From<argon2::Error> for CryptoError {
    fn from(e: argon2::Error) -> Self {
        CryptoError::Kdf(e.to_string())
    }
}