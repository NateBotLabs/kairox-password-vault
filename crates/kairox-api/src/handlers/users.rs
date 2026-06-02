use axum::{extract::{Path, State}, Json};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sea_orm::EntityTrait;
use serde::Serialize;
use uuid::Uuid;

use crate::{entity::user, error::ApiError, jwt::AuthUser, state::AppState};

#[derive(Serialize)]
pub struct UserDto {
    pub id: Uuid,
    pub email: String,
    pub public_key: String,  // base64
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<user::Model> for UserDto {
    fn from(m: user::Model) -> Self {
        UserDto {
            id:         m.id,
            email:      m.email,
            public_key: BASE64.encode(&m.public_key),
            created_at: m.created_at.with_timezone(&chrono::Utc),
        }
    }
}

pub async fn me(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<UserDto>, ApiError> {
    let user = user::Entity::find_by_id(auth.user_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(UserDto::from(user)))
}

/// Returns only the public key — needed by clients who want to wrap a
/// Collection Key for another user.
pub async fn public_key(
    State(state): State<AppState>,
    _auth: AuthUser,
    Path(user_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let user = user::Entity::find_by_id(user_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    Ok(Json(serde_json::json!({ "public_key": BASE64.encode(&user.public_key) })))
}
