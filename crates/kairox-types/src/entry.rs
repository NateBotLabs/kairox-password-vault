use serde::{Deserialize, Serialize};
use crate::error::TypesError;

/// The plaintext vault entry — serialized to CBOR then encrypted with the Collection Key.
/// The `id` is included inside the plaintext so the client can verify it matches
/// the outer `EncryptedEntry::id` after decryption.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultEntry {
    pub id: [u8; 16],
    pub version: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum EntryKind {
    Login(LoginEntry),
    SecureNote(SecureNote),
    CreditCard(CreditCard),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginEntry {
    pub name: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub totp_secret: Option<String>,
    pub notes: Option<String>,
    pub custom_fields: Vec<CustomField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecureNote {
    pub title: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreditCard {
    pub name: String,
    pub number: String,
    pub expiry_month: u8,
    pub expiry_year: u16,
    pub cvv: String,
    pub cardholder: String,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub name: String,
    pub value: String,
    /// If true, the field value should be masked in the UI by default.
    pub hidden: bool,
}

impl VaultEntry {
    pub fn to_cbor(&self) -> Result<Vec<u8>, TypesError> {
        let mut buf = Vec::new();
        ciborium::ser::into_writer(self, &mut buf)
            .map_err(|e| TypesError::Serialize(e.to_string()))?;
        Ok(buf)
    }

    pub fn from_cbor(bytes: &[u8]) -> Result<Self, TypesError> {
        ciborium::de::from_reader(bytes).map_err(|e| TypesError::Deserialize(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entry() -> VaultEntry {
        VaultEntry {
            id: [1u8; 16],
            version: 1,
            created_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            kind: EntryKind::Login(LoginEntry {
                name: "GitHub".into(),
                username: "alice@example.com".into(),
                password: "hunter2".into(),
                url: Some("https://github.com".into()),
                totp_secret: None,
                notes: None,
                custom_fields: vec![],
            }),
        }
    }

    #[test]
    fn cbor_round_trip_login() {
        let entry = sample_entry();
        let bytes = entry.to_cbor().unwrap();
        let recovered = VaultEntry::from_cbor(&bytes).unwrap();

        assert_eq!(recovered.id, entry.id);
        assert_eq!(recovered.version, entry.version);
        match recovered.kind {
            EntryKind::Login(l) => {
                assert_eq!(l.name, "GitHub");
                assert_eq!(l.password, "hunter2");
            }
            _ => panic!("unexpected variant"),
        }
    }

    #[test]
    fn cbor_round_trip_secure_note() {
        let entry = VaultEntry {
            id: [2u8; 16],
            version: 1,
            created_at: 0,
            updated_at: 0,
            kind: EntryKind::SecureNote(SecureNote {
                title: "SSH key passphrase".into(),
                content: "correct horse battery staple".into(),
            }),
        };
        let bytes = entry.to_cbor().unwrap();
        let recovered = VaultEntry::from_cbor(&bytes).unwrap();
        match recovered.kind {
            EntryKind::SecureNote(n) => assert_eq!(n.content, "correct horse battery staple"),
            _ => panic!("unexpected variant"),
        }
    }

    #[test]
    fn corrupt_cbor_fails() {
        assert!(VaultEntry::from_cbor(b"not cbor at all").is_err());
    }

    #[test]
    fn custom_fields_survive_round_trip() {
        let entry = VaultEntry {
            id: [3u8; 16],
            version: 1,
            created_at: 0,
            updated_at: 0,
            kind: EntryKind::Login(LoginEntry {
                name: "Corp VPN".into(),
                username: "bob".into(),
                password: "secret".into(),
                url: None,
                totp_secret: None,
                notes: None,
                custom_fields: vec![
                    CustomField { name: "PIN".into(), value: "1234".into(), hidden: true },
                    CustomField { name: "Region".into(), value: "EU".into(), hidden: false },
                ],
            }),
        };
        let recovered = VaultEntry::from_cbor(&entry.to_cbor().unwrap()).unwrap();
        let EntryKind::Login(l) = recovered.kind else { panic!() };
        assert_eq!(l.custom_fields.len(), 2);
        assert!(l.custom_fields[0].hidden);
        assert!(!l.custom_fields[1].hidden);
    }
}
