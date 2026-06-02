//! Tauri IPC commands exposed to the WebView frontend.
//!
//! Security model: all key material stays in this Rust process.
//! The WebView receives only ciphertext, wrapped keys, and the non-secret
//! `auth_key` / `public_key` values needed for server communication.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use kairox_crypto::{decrypt, encrypt, unwrap_key, wrap_key, CollectionKey, MasterKey, UserKeyPair};
use rand::{rngs::OsRng, RngCore};
use serde::Serialize;
use tauri::State;
use x25519_dalek::PublicKey;
use zeroize::Zeroizing;

use crate::state::{AppState, VaultSession};

// ── Helper ────────────────────────────────────────────────────────────────────

fn uuid_to_bytes(id: &str) -> Vec<u8> {
    let hex = id.replace('-', "");
    (0..hex.len())
        .step_by(2)
        .filter_map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}

fn err(e: impl ToString) -> String { e.to_string() }

// ── Key derivation ────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct DeriveResult {
    /// base64 — send to server as `auth_key` during login/register
    pub auth_key: String,
    /// base64 — register once with server so others can wrap keys for you
    pub public_key: String,
}

/// Derive all keys from the master password.
/// Stores the session in Tauri state; returns only the non-secret outputs.
#[tauri::command]
pub async fn kx_derive(
    state: State<'_, AppState>,
    password: Vec<u8>,
    salt: Vec<u8>,
) -> Result<DeriveResult, String> {
    let master_key = MasterKey::derive(&password, &salt).map_err(err)?;

    let sym_key      = master_key.symmetric_key();
    let auth_key     = master_key.auth_key();
    let identity_key = master_key.identity_key();
    let keypair      = UserKeyPair::from_seed(&identity_key);

    let result = DeriveResult {
        auth_key:   BASE64.encode(auth_key.as_ref()),
        public_key: BASE64.encode(keypair.public_bytes()),
    };

    let mut guard = state.session.lock().map_err(err)?;
    *guard = Some(VaultSession {
        symmetric_key: sym_key,
        keypair,
        collection_keys: Default::default(),
    });

    Ok(result)
}

/// Zeroize all session key material.
#[tauri::command]
pub async fn kx_lock(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.session.lock().map_err(err)?;
    *guard = None; // drops VaultSession, triggering ZeroizeOnDrop on all keys
    Ok(())
}

// ── Salt / key generation ─────────────────────────────────────────────────────

/// Generate a fresh 32-byte Argon2 salt. Not secret — store on server.
#[tauri::command]
pub async fn kx_generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; 32];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Generate a new Collection Key, store it under `collection_id`, and wrap it
/// for the current user. Returns the wrapped bytes (base64) to send to the server.
///
/// `aad` should be the collection UUID bytes so the wrapped key is cryptographically
/// bound to this specific collection.
#[tauri::command]
pub async fn kx_generate_collection_key(
    state: State<'_, AppState>,
    collection_id: String,
    aad: Vec<u8>,
) -> Result<String, String> {
    let ck = CollectionKey::generate();

    let mut guard = state.session.lock().map_err(err)?;
    let session = guard.as_mut().ok_or("vault is locked")?;

    let wrapped = wrap_key(&session.keypair.public, ck.as_bytes(), &aad).map_err(err)?;
    session.collection_keys.insert(collection_id, ck);

    Ok(BASE64.encode(&wrapped))
}

/// Unwrap and store a Collection Key received from the server.
#[tauri::command]
pub async fn kx_load_collection_key(
    state: State<'_, AppState>,
    collection_id: String,
    wrapped_b64: String,
) -> Result<(), String> {
    let wrapped = BASE64.decode(&wrapped_b64).map_err(err)?;
    let aad = uuid_to_bytes(&collection_id);

    let mut guard = state.session.lock().map_err(err)?;
    let session = guard.as_mut().ok_or("vault is locked")?;

    let ck_bytes = unwrap_key(&session.keypair, &wrapped, &aad).map_err(err)?;
    let ck = CollectionKey::from_slice(&ck_bytes).ok_or("invalid collection key length")?;
    session.collection_keys.insert(collection_id, ck);

    Ok(())
}

// ── Vault entry encrypt / decrypt ─────────────────────────────────────────────

/// Encrypt a vault entry with the stored Collection Key.
/// `aad` should be the entry UUID bytes.
#[tauri::command]
pub async fn kx_encrypt_entry(
    state: State<'_, AppState>,
    collection_id: String,
    plaintext: Vec<u8>,
    aad: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let guard = state.session.lock().map_err(err)?;
    let session = guard.as_ref().ok_or("vault is locked")?;
    let ck = session.collection_keys.get(&collection_id)
        .ok_or("collection key not loaded — call kx_load_collection_key first")?;
    encrypt(ck.as_bytes(), &plaintext, &aad).map_err(err)
}

/// Decrypt a vault entry.
#[tauri::command]
pub async fn kx_decrypt_entry(
    state: State<'_, AppState>,
    collection_id: String,
    ciphertext: Vec<u8>,
    aad: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let guard = state.session.lock().map_err(err)?;
    let session = guard.as_ref().ok_or("vault is locked")?;
    let ck = session.collection_keys.get(&collection_id)
        .ok_or("collection key not loaded")?;
    decrypt(ck.as_bytes(), &ciphertext, &aad).map_err(err)
}

// ── Collection sharing ────────────────────────────────────────────────────────

/// Wrap the stored Collection Key for another user's public key.
/// `aad` is the collection UUID bytes — same as used when the CK was first created.
#[tauri::command]
pub async fn kx_wrap_collection_key_for(
    state: State<'_, AppState>,
    collection_id: String,
    recipient_public_b64: String,
) -> Result<String, String> {
    let pk_bytes: [u8; 32] = BASE64
        .decode(&recipient_public_b64)
        .map_err(err)?
        .try_into()
        .map_err(|_| "recipient public key must be 32 bytes")?;
    let pk = PublicKey::from(pk_bytes);

    let guard = state.session.lock().map_err(err)?;
    let session = guard.as_ref().ok_or("vault is locked")?;
    let ck = session.collection_keys.get(&collection_id)
        .ok_or("collection key not loaded")?;

    let aad = uuid_to_bytes(&collection_id);
    let wrapped = wrap_key(&pk, ck.as_bytes(), &aad).map_err(err)?;
    Ok(BASE64.encode(&wrapped))
}

// ── Personal symmetric encryption (not collection-scoped) ─────────────────────

/// Encrypt with the personal symmetric key (derived from master key).
#[tauri::command]
pub async fn kx_encrypt(
    state: State<'_, AppState>,
    plaintext: Vec<u8>,
    aad: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let guard = state.session.lock().map_err(err)?;
    let session = guard.as_ref().ok_or("vault is locked")?;
    let key = Zeroizing::new(*session.symmetric_key);
    encrypt(&key, &plaintext, &aad).map_err(err)
}

/// Decrypt with the personal symmetric key.
#[tauri::command]
pub async fn kx_decrypt(
    state: State<'_, AppState>,
    ciphertext: Vec<u8>,
    aad: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let guard = state.session.lock().map_err(err)?;
    let session = guard.as_ref().ok_or("vault is locked")?;
    let key = Zeroizing::new(*session.symmetric_key);
    decrypt(&key, &ciphertext, &aad).map_err(err)
}
