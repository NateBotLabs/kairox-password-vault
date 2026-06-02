use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{extract::{Query, State}, http::StatusCode, Json};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, Set};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{entity::user, error::ApiError, jwt::encode_jwt, state::AppState};

// ── Request / response types ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub email: String,
    /// base64(MasterKey::auth_key()) — 32 bytes derived client-side with Argon2id
    pub auth_key: String,
    /// base64(X25519 public key, 32 bytes)
    pub public_key: String,
    /// base64(random 32-byte Argon2 salt) — generated client-side, stored for future logins
    pub salt: String,
}

#[derive(Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub auth_key: String,
}

#[derive(Deserialize)]
pub struct GetSaltParams {
    pub email: String,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user_id: Uuid,
}

#[derive(Serialize)]
pub struct SaltResponse {
    /// base64-encoded 32-byte Argon2 salt. Not secret.
    pub salt: String,
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// Return the stored Argon2 salt for a given email so the client can re-derive
/// their keys before calling /login. The salt is not secret.
pub async fn get_salt(
    State(state): State<AppState>,
    Query(params): Query<GetSaltParams>,
) -> Result<Json<SaltResponse>, ApiError> {
    let user = user::Entity::find()
        .filter(user::Column::Email.eq(&params.email))
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    Ok(Json(SaltResponse { salt: BASE64.encode(&user.salt) }))
}

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<AuthResponse>), ApiError> {
    let auth_key_bytes = BASE64
        .decode(&req.auth_key)
        .map_err(|_| ApiError::BadRequest("invalid auth_key encoding".into()))?;
    if auth_key_bytes.len() != 32 {
        return Err(ApiError::BadRequest("auth_key must be 32 bytes".into()));
    }

    let public_key_bytes = BASE64
        .decode(&req.public_key)
        .map_err(|_| ApiError::BadRequest("invalid public_key encoding".into()))?;
    if public_key_bytes.len() != 32 {
        return Err(ApiError::BadRequest("public_key must be 32 bytes".into()));
    }

    let salt_bytes = BASE64
        .decode(&req.salt)
        .map_err(|_| ApiError::BadRequest("invalid salt encoding".into()))?;
    if salt_bytes.len() != 32 {
        return Err(ApiError::BadRequest("salt must be 32 bytes".into()));
    }

    let taken = user::Entity::find()
        .filter(user::Column::Email.eq(&req.email))
        .count(&state.db)
        .await?;
    if taken > 0 {
        return Err(ApiError::Conflict("email already registered".into()));
    }

    let argon_salt = SaltString::generate(&mut OsRng);
    let auth_hash = Argon2::default()
        .hash_password(&auth_key_bytes, &argon_salt)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?
        .to_string();

    let user_id = Uuid::new_v4();
    user::ActiveModel {
        id:         Set(user_id),
        email:      Set(req.email),
        auth_hash:  Set(auth_hash),
        public_key: Set(public_key_bytes),
        salt:       Set(salt_bytes),
        ..Default::default()
    }
    .insert(&state.db)
    .await?;

    let token = encode_jwt(user_id, &state.jwt_secret)?;
    Ok((StatusCode::CREATED, Json(AuthResponse { token, user_id })))
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    let auth_key_bytes = BASE64
        .decode(&req.auth_key)
        .map_err(|_| ApiError::BadRequest("invalid auth_key encoding".into()))?;

    let user = user::Entity::find()
        .filter(user::Column::Email.eq(&req.email))
        .one(&state.db)
        .await?
        .ok_or(ApiError::Unauthorized)?;

    let hash = PasswordHash::new(&user.auth_hash)
        .map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    Argon2::default()
        .verify_password(&auth_key_bytes, &hash)
        .map_err(|_| ApiError::Unauthorized)?;

    let token = encode_jwt(user.id, &state.jwt_secret)?;
    Ok(Json(AuthResponse { token, user_id: user.id }))
}
