/// End-to-end test of the full zero-knowledge flow:
///
///   1. Alice derives her MasterKey from password + salt
///   2. Alice's UserKeyPair is derived (deterministic from master key)
///   3. A Collection Key is generated and wrapped for Alice
///   4. A VaultEntry is serialized to CBOR and encrypted with the Collection Key
///   5. Alice unwraps the Collection Key, decrypts the entry, verifies contents
use kairox_crypto::{
    decrypt, encrypt, unwrap_key, wrap_key, CollectionKey, MasterKey, UserKeyPair,
};
use kairox_types::{EntryKind, LoginEntry, VaultEntry};

#[test]
fn full_vault_entry_lifecycle() {
    // --- Setup: Alice derives her keys from her master password ---
    let master_key = MasterKey::derive(b"correct horse battery staple", &[0xAA; 32]).unwrap();
    let identity_seed = master_key.identity_key();
    let alice = UserKeyPair::from_seed(&identity_seed);

    // --- Server side: generate a Collection Key, wrap it for Alice ---
    let collection_id = [0x01u8; 16];
    let ck = CollectionKey::generate();
    let wrapped = wrap_key(&alice.public, ck.as_bytes(), &collection_id).unwrap();

    // --- Create a plaintext vault entry ---
    let entry_id = [0x02u8; 16];
    let entry = VaultEntry {
        id: entry_id,
        version: 1,
        created_at: 1_700_000_000,
        updated_at: 1_700_000_000,
        kind: EntryKind::Login(LoginEntry {
            name: "GitHub".into(),
            username: "alice@example.com".into(),
            password: "s3cr3t!".into(),
            url: Some("https://github.com".into()),
            totp_secret: None,
            notes: None,
            custom_fields: vec![],
        }),
    };

    // --- Encrypt entry with Collection Key (entry_id as AAD) ---
    let plaintext = entry.to_cbor().unwrap();
    let ciphertext = encrypt(ck.as_bytes(), &plaintext, &entry_id).unwrap();

    // --- Alice unwraps the Collection Key ---
    let ck_bytes = unwrap_key(&alice, &wrapped, &collection_id).unwrap();
    let recovered_ck = CollectionKey::from_slice(&ck_bytes).unwrap();

    // --- Alice decrypts the entry ---
    let decrypted_cbor = decrypt(recovered_ck.as_bytes(), &ciphertext, &entry_id).unwrap();
    let recovered_entry = VaultEntry::from_cbor(&decrypted_cbor).unwrap();

    // --- Verify ---
    assert_eq!(recovered_entry.id, entry_id);
    assert_eq!(recovered_entry.version, 1);
    let EntryKind::Login(login) = recovered_entry.kind else {
        panic!("expected Login variant");
    };
    assert_eq!(login.name, "GitHub");
    assert_eq!(login.username, "alice@example.com");
    assert_eq!(login.password, "s3cr3t!");
}

#[test]
fn wrong_collection_key_cannot_decrypt_entry() {
    let master_key = MasterKey::derive(b"password", &[0xBB; 32]).unwrap();
    let alice = UserKeyPair::from_seed(&master_key.identity_key());

    let collection_id = [0x10u8; 16];
    let ck = CollectionKey::generate();
    let wrong_ck = CollectionKey::generate();

    let entry = VaultEntry {
        id: [0x20u8; 16],
        version: 1,
        created_at: 0,
        updated_at: 0,
        kind: EntryKind::SecureNote(kairox_types::SecureNote {
            title: "Secret".into(),
            content: "top secret".into(),
        }),
    };

    let ciphertext = encrypt(ck.as_bytes(), &entry.to_cbor().unwrap(), &entry.id).unwrap();

    // Decrypting with a different key must fail authentication
    assert!(decrypt(wrong_ck.as_bytes(), &ciphertext, &entry.id).is_err());

    // Decrypting with correct key but wrong AAD must also fail
    assert!(decrypt(ck.as_bytes(), &ciphertext, &collection_id).is_err());

    // Only correct key + correct AAD succeeds
    let ok = decrypt(ck.as_bytes(), &ciphertext, &entry.id).unwrap();
    let _ = alice; // silence unused warning — alice present for setup realism
    assert!(!ok.is_empty());
}
