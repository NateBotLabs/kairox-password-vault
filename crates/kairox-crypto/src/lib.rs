mod error;
mod kdf;
mod aead;
mod keywrap;
mod collection_key;
#[cfg(feature = "wasm")]
mod wasm;

pub use error::CryptoError;
pub use kdf::MasterKey;
pub use aead::{decrypt, encrypt};
pub use keywrap::{unwrap_key, wrap_key, UserKeyPair};
pub use collection_key::CollectionKey;
