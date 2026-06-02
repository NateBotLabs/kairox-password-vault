use std::collections::HashMap;
use std::sync::Mutex;

use kairox_crypto::{CollectionKey, UserKeyPair};
use zeroize::Zeroizing;

/// All cryptographic key material for the current session.
/// Lives entirely inside the Tauri (Rust) process — the WebView never sees
/// any raw key bytes.
pub struct VaultSession {
    pub symmetric_key: Zeroizing<[u8; 32]>,
    pub keypair: UserKeyPair,
    /// Collection Keys loaded from server-stored wrapped blobs.
    pub collection_keys: HashMap<String, CollectionKey>,
}

/// Tauri managed state — access via `State<'_, AppState>` in commands.
pub struct AppState {
    pub session: Mutex<Option<VaultSession>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState { session: Mutex::new(None) }
    }
}
