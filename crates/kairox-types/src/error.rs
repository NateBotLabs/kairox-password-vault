use thiserror::Error;

#[derive(Debug, Error)]
pub enum TypesError {
    #[error("serialization failed: {0}")]
    Serialize(String),

    #[error("deserialization failed: {0}")]
    Deserialize(String),
}
