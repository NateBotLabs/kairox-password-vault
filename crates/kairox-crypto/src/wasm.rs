/// WASM bindings — compiled only when `--features wasm` is set.
///
/// Exposes `KairoxVault`: derive it from a master password, then use it to
/// encrypt/decrypt vault entries, wrap/unwrap collection keys, and obtain the
/// auth token sent to the server.
///
/// Build:  wasm-pack build crates/kairox-crypto --target web --features wasm
use wasm_bindgen::prelude::*;
use x25519_dalek::PublicKey;

use crate::{
    aead,
    collection_key::CollectionKey,
    error::CryptoError,
    kdf::MasterKey,
    keywrap::{self, UserKeyPair},
};

fn to_js(e: CryptoError) -> JsValue {
    JsValue::from_str(&e.to_string())
}

// ── KairoxVault ───────────────────────────────────────────────────────────────

/// The main entry point for all client-side crypto.
///
/// ```js
/// const vault = await KairoxVault.derive(password, salt);
/// const authKey   = vault.auth_key();          // send to server for login
/// const publicKey = vault.public_key();         // register once with server
/// ```
#[wasm_bindgen]
pub struct KairoxVault {
    master_key: MasterKey,
    keypair: UserKeyPair,
}

#[wasm_bindgen]
impl KairoxVault {
    /// Derive all keys from a UTF-8 password and a 32-byte random salt.
    ///
    /// This is intentionally slow (Argon2id, 64 MiB) — run it off the main
    /// thread via a Web Worker.
    #[wasm_bindgen(constructor)]
    pub fn derive(password: &[u8], salt: &[u8]) -> Result<KairoxVault, JsValue> {
        console_error_panic_hook::set_once();

        let master_key = MasterKey::derive(password, salt).map_err(to_js)?;
        let identity_seed = master_key.identity_key();
        let keypair = UserKeyPair::from_seed(&identity_seed);
        Ok(KairoxVault { master_key, keypair })
    }

    /// 32-byte auth token to send to the server during register/login.
    /// Domain-separated from the symmetric key — the server cannot derive
    /// the encryption key even if it stores this value.
    pub fn auth_key(&self) -> Vec<u8> {
        self.master_key.auth_key().to_vec()
    }

    /// 32-byte X25519 public key — register once with the server so that
    /// other users can wrap Collection Keys for you.
    pub fn public_key(&self) -> Vec<u8> {
        self.keypair.public_bytes().to_vec()
    }

    // ── Vault-entry encryption (uses the personal symmetric key) ──────────

    /// Encrypt `plaintext` with the vault's symmetric key.
    /// `aad` is authenticated-but-not-encrypted context (e.g. entry UUID bytes).
    pub fn encrypt(&self, plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsValue> {
        let key = self.master_key.symmetric_key();
        aead::encrypt(&key, plaintext, aad).map_err(to_js)
    }

    /// Decrypt ciphertext produced by `encrypt`.
    pub fn decrypt(&self, ciphertext: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsValue> {
        let key = self.master_key.symmetric_key();
        aead::decrypt(&key, ciphertext, aad).map_err(to_js)
    }

    // ── Collection-key operations ─────────────────────────────────────────

    /// Encrypt `plaintext` with an explicit 32-byte Collection Key.
    /// Use this for shared collections where the CK is not the personal key.
    pub fn encrypt_with_key(
        &self,
        key: &[u8],
        plaintext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        let k: [u8; 32] = key.try_into().map_err(|_| JsValue::from_str("key must be 32 bytes"))?;
        aead::encrypt(&k, plaintext, aad).map_err(to_js)
    }

    /// Decrypt ciphertext produced by `encrypt_with_key`.
    pub fn decrypt_with_key(
        &self,
        key: &[u8],
        ciphertext: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        let k: [u8; 32] = key.try_into().map_err(|_| JsValue::from_str("key must be 32 bytes"))?;
        aead::decrypt(&k, ciphertext, aad).map_err(to_js)
    }

    /// Wrap `key_material` for a recipient identified by their 32-byte public key.
    /// `aad` should be the collection UUID bytes to prevent ciphertext transplant.
    pub fn wrap_key_for(
        &self,
        recipient_public: &[u8],
        key_material: &[u8],
        aad: &[u8],
    ) -> Result<Vec<u8>, JsValue> {
        let pk_bytes: [u8; 32] = recipient_public
            .try_into()
            .map_err(|_| JsValue::from_str("recipient_public must be 32 bytes"))?;
        let pk = PublicKey::from(pk_bytes);
        keywrap::wrap_key(&pk, key_material, aad).map_err(to_js)
    }

    /// Unwrap a Collection Key that was wrapped for this vault's identity key.
    pub fn unwrap_key(&self, wrapped: &[u8], aad: &[u8]) -> Result<Vec<u8>, JsValue> {
        keywrap::unwrap_key(&self.keypair, wrapped, aad).map_err(to_js)
    }
}

// ── Free functions ────────────────────────────────────────────────────────────

/// Generate a cryptographically random 32-byte Collection Key.
/// Wrap it with `vault.wrap_key_for(...)` before sending to the server.
#[wasm_bindgen]
pub fn generate_collection_key() -> Vec<u8> {
    CollectionKey::generate().as_bytes().to_vec()
}

/// Generate a cryptographically random 32-byte Argon2 salt.
/// Store it alongside the user's account; it is NOT secret.
#[wasm_bindgen]
pub fn generate_salt() -> Vec<u8> {
    use rand::{rngs::OsRng, RngCore};
    let mut salt = vec![0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}
