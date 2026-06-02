use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("not found")]
    NotFound,
    #[error("unauthorized")]
    Unauthorized,
    #[error("forbidden")]
    Forbidden,
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("internal error")]
    Internal(#[source] anyhow::Error),
}

impl From<sea_orm::DbErr> for ApiError {
    fn from(e: sea_orm::DbErr) -> Self {
        match e {
            sea_orm::DbErr::RecordNotFound(_) => ApiError::NotFound,
            other => ApiError::Internal(anyhow::anyhow!(other)),
        }
    }
}

impl From<sea_orm::TransactionError<sea_orm::DbErr>> for ApiError {
    fn from(e: sea_orm::TransactionError<sea_orm::DbErr>) -> Self {
        ApiError::Internal(anyhow::anyhow!(e.to_string()))
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::Internal(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::NotFound      => (StatusCode::NOT_FOUND,            "not found".into()),
            ApiError::Unauthorized  => (StatusCode::UNAUTHORIZED,         "unauthorized".into()),
            ApiError::Forbidden     => (StatusCode::FORBIDDEN,            "forbidden".into()),
            ApiError::Conflict(m)   => (StatusCode::CONFLICT,             m.clone()),
            ApiError::BadRequest(m) => (StatusCode::BAD_REQUEST,          m.clone()),
            ApiError::Internal(e)   => {
                tracing::error!("internal error: {e:#}");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal server error".into())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}
