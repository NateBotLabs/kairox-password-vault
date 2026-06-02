use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use x25519_dalek::{EphemeralSecret, PublicKey, StaticSecret};
use zeroize::Zeroizing;

use crate::aead;
use crate::error::CryptoError;

const VERSION: u8 = 1;
const PUBLIC_KEY_LEN: usize = 32;
// version(1) + ephemeral_public(32) + min aead output(1+24+16)
const MIN_PAYLOAD_LEN: usize = 1 + PUBLIC_KEY_LEN + 41;
const KEYWRAP_INFO: &[u8] = b"kairox-keywrap-v1";

/// A user's long-term X25519 identity keypair.
///
/// The secret is derived from `MasterKey::identity_key()` so it is
/// deterministic across sessions — no need to store the private key.
pub struct UserKeyPair {
    pub secret: StaticSecret,
    pub public: PublicKey,
}

impl UserKeyPair {
    /// Construct from a 32-byte seed (e.g. `MasterKey::identity_key()`).
    /// The seed bytes are zeroized after use.
    pub fn from_seed(seed: &[u8; 32]) -> Self {
        let bytes = Zeroizing::new(*seed);
        let secret = StaticSecret::from(*bytes);
        let public = PublicKey::from(&secret);
        Self { secret, public }
    }

    pub fn public_bytes(&self) -> [u8; 32] {
        self.public.to_bytes()
    }
}

/// Wrap (encrypt) `key_material` for a recipient identified by their public key.
///
/// Uses ECIES: ephemeral X25519 ECDH → HKDF-SHA256 → XChaCha20-Poly1305.
/// `aad` is authenticated but not encrypted — use it to bind the wrapped key
/// to a collection ID or user ID to prevent ciphertext transplant attacks.
///
/// Output: `[version:1][ephemeral_public:32][aead_payload]`
pub fn wrap_key(
    recipient_public: &PublicKey,
    key_material: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let ephemeral_secret = EphemeralSecret::random_from_rng(OsRng);
    let ephemeral_public = PublicKey::from(&ephemeral_secret);

    let shared = ephemeral_secret.diffie_hellman(recipient_public);
    let wrapping_key = derive_wrapping_key(shared.as_bytes());

    let encrypted = aead::encrypt(&wrapping_key, key_material, aad)?;

    let mut out = Vec::with_capacity(1 + PUBLIC_KEY_LEN + encrypted.len());
    out.push(VERSION);
    out.extend_from_slice(ephemeral_public.as_bytes());
    out.extend_from_slice(&encrypted);
    Ok(out)
}

/// Unwrap a key wrapped by [`wrap_key`] using the recipient's private key.
pub fn unwrap_key(
    recipient: &UserKeyPair,
    payload: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if payload.len() < MIN_PAYLOAD_LEN {
        return Err(CryptoError::Decrypt);
    }

    let version = payload[0];
    if version != VERSION {
        return Err(CryptoError::UnsupportedVersion(version));
    }

    let ephemeral_public = PublicKey::from(
        <[u8; PUBLIC_KEY_LEN]>::try_from(&payload[1..1 + PUBLIC_KEY_LEN]).unwrap(),
    );
    let aead_payload = &payload[1 + PUBLIC_KEY_LEN..];

    let shared = recipient.secret.diffie_hellman(&ephemeral_public);
    let wrapping_key = derive_wrapping_key(shared.as_bytes());

    aead::decrypt(&wrapping_key, aead_payload, aad)
}

fn derive_wrapping_key(shared_secret: &[u8]) -> Zeroizing<[u8; 32]> {
    let hkdf = Hkdf::<Sha256>::new(None, shared_secret);
    let mut key = Zeroizing::new([0u8; 32]);
    hkdf.expand(KEYWRAP_INFO, key.as_mut()).expect("HKDF expand failed");
    key
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alice() -> UserKeyPair {
        UserKeyPair::from_seed(&[0x01u8; 32])
    }

    fn bob() -> UserKeyPair {
        UserKeyPair::from_seed(&[0x02u8; 32])
    }

    #[test]
    fn wrap_unwrap_round_trip() {
        let alice = alice();
        let collection_key = [0xABu8; 32];
        let aad = b"collection-id-42";

        let wrapped = wrap_key(&alice.public, &collection_key, aad).unwrap();
        let recovered = unwrap_key(&alice, &wrapped, aad).unwrap();

        assert_eq!(recovered, collection_key);
    }

    #[test]
    fn ephemeral_keys_differ_per_wrap() {
        let alice = alice();
        let ck = [0xABu8; 32];
        let w1 = wrap_key(&alice.public, &ck, b"").unwrap();
        let w2 = wrap_key(&alice.public, &ck, b"").unwrap();
        // ephemeral public key is at bytes 1..33
        assert_ne!(&w1[1..33], &w2[1..33]);
    }

    #[test]
    fn wrong_recipient_fails() {
        let alice = alice();
        let bob = bob();
        let ck = [0xABu8; 32];

        let wrapped = wrap_key(&alice.public, &ck, b"ctx").unwrap();
        assert!(matches!(unwrap_key(&bob, &wrapped, b"ctx"), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn wrong_aad_fails() {
        let alice = alice();
        let ck = [0xABu8; 32];
        let wrapped = wrap_key(&alice.public, &ck, b"collection-1").unwrap();
        assert!(matches!(
            unwrap_key(&alice, &wrapped, b"collection-2"),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn tampered_payload_fails() {
        let alice = alice();
        let mut wrapped = wrap_key(&alice.public, &[0xABu8; 32], b"ctx").unwrap();
        let last = wrapped.len() - 1;
        wrapped[last] ^= 0xff;
        assert!(matches!(unwrap_key(&alice, &wrapped, b"ctx"), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn truncated_payload_fails() {
        let alice = alice();
        assert!(matches!(
            unwrap_key(&alice, &[0u8; 10], b""),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn unknown_version_fails() {
        let alice = alice();
        let mut wrapped = wrap_key(&alice.public, &[0xABu8; 32], b"").unwrap();
        wrapped[0] = 99;
        assert!(matches!(
            unwrap_key(&alice, &wrapped, b""),
            Err(CryptoError::UnsupportedVersion(99))
        ));
    }

    #[test]
    fn from_seed_is_deterministic() {
        let seed = [0x42u8; 32];
        let kp1 = UserKeyPair::from_seed(&seed);
        let kp2 = UserKeyPair::from_seed(&seed);
        assert_eq!(kp1.public_bytes(), kp2.public_bytes());
    }
}
