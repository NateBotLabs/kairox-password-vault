use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

use crate::error::CryptoError;

const NONCE_LEN: usize = 24;
const VERSION: u8 = 1;
// version(1) + nonce(24) + poly1305 tag(16) minimum
const MIN_PAYLOAD_LEN: usize = 1 + NONCE_LEN + 16;

/// Encrypt `plaintext` with XChaCha20-Poly1305.
///
/// `aad` is authenticated but not encrypted — use it to bind the ciphertext to
/// a context (e.g. entry ID, collection ID) to prevent ciphertext transplant attacks.
///
/// Output layout: `[version: 1][nonce: 24][ciphertext + tag]`
pub fn encrypt(key: &[u8; 32], plaintext: &[u8], aad: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = XChaCha20Poly1305::new(key.into());

    let mut nonce_bytes = Zeroizing::new([0u8; NONCE_LEN]);
    OsRng.fill_bytes(nonce_bytes.as_mut());
    let nonce = XNonce::from(*nonce_bytes);

    let ciphertext = cipher
        .encrypt(&nonce, Payload { msg: plaintext, aad })
        .map_err(|_| CryptoError::Encrypt)?;

    let mut out = Vec::with_capacity(1 + NONCE_LEN + ciphertext.len());
    out.push(VERSION);
    out.extend_from_slice(nonce_bytes.as_ref());
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a payload produced by [`encrypt`].
///
/// The same `aad` used during encryption must be supplied; any mismatch causes
/// authentication to fail and `CryptoError::Decrypt` is returned.
pub fn decrypt(key: &[u8; 32], payload: &[u8], aad: &[u8]) -> Result<Vec<u8>, CryptoError> {
    if payload.len() < MIN_PAYLOAD_LEN {
        return Err(CryptoError::Decrypt);
    }

    let version = payload[0];
    if version != VERSION {
        return Err(CryptoError::UnsupportedVersion(version));
    }

    let nonce = XNonce::from_slice(&payload[1..1 + NONCE_LEN]);
    let ciphertext = &payload[1 + NONCE_LEN..];

    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad })
        .map_err(|_| CryptoError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key() -> [u8; 32] {
        [0x42u8; 32]
    }

    #[test]
    fn round_trip() {
        let key = test_key();
        let plaintext = b"super secret password";
        let aad = b"entry-id-1234";

        let payload = encrypt(&key, plaintext, aad).unwrap();
        let recovered = decrypt(&key, &payload, aad).unwrap();
        assert_eq!(recovered, plaintext);
    }

    #[test]
    fn nonces_are_unique() {
        let key = test_key();
        let p1 = encrypt(&key, b"data", b"").unwrap();
        let p2 = encrypt(&key, b"data", b"").unwrap();
        // nonces live at bytes 1..25
        assert_ne!(&p1[1..25], &p2[1..25]);
    }

    #[test]
    fn wrong_key_fails() {
        let key = test_key();
        let payload = encrypt(&key, b"secret", b"ctx").unwrap();

        let bad_key = [0x00u8; 32];
        assert!(matches!(decrypt(&bad_key, &payload, b"ctx"), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn wrong_aad_fails() {
        let key = test_key();
        let payload = encrypt(&key, b"secret", b"good-ctx").unwrap();
        assert!(matches!(decrypt(&key, &payload, b"bad-ctx"), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn tampered_ciphertext_fails() {
        let key = test_key();
        let mut payload = encrypt(&key, b"secret", b"ctx").unwrap();
        // flip last byte of ciphertext
        let last = payload.len() - 1;
        payload[last] ^= 0xff;
        assert!(matches!(decrypt(&key, &payload, b"ctx"), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn truncated_payload_fails() {
        let key = test_key();
        assert!(matches!(decrypt(&key, &[0u8; 10], b""), Err(CryptoError::Decrypt)));
    }

    #[test]
    fn unknown_version_fails() {
        let key = test_key();
        let mut payload = encrypt(&key, b"secret", b"").unwrap();
        payload[0] = 99; // corrupt version byte
        assert!(matches!(decrypt(&key, &payload, b""), Err(CryptoError::UnsupportedVersion(99))));
    }
}
