use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, PaginatorTrait,
    QueryFilter, QueryOrder, Set,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    entity::{entry, wrapped_key},
    error::ApiError,
    jwt::AuthUser,
    state::AppState,
};

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateEntryRequest {
    pub collection_id: Uuid,
    /// base64(aead::encrypt(collection_key, cbor(VaultEntry), entry_id_as_aad))
    pub ciphertext: String,
}

#[derive(Deserialize)]
pub struct UpdateEntryRequest {
    pub ciphertext: String,
    /// Must match the entry's current version; mismatch → 409 Conflict.
    pub expected_version: i32,
}

#[derive(Serialize)]
pub struct EntryDto {
    pub id: Uuid,
    pub collection_id: Uuid,
    pub version: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub ciphertext: String,  // base64
}

impl From<entry::Model> for EntryDto {
    fn from(m: entry::Model) -> Self {
        EntryDto {
            id:            m.id,
            collection_id: m.collection_id,
            version:       m.version,
            created_at:    m.created_at.with_timezone(&chrono::Utc),
            updated_at:    m.updated_at.with_timezone(&chrono::Utc),
            ciphertext:    BASE64.encode(&m.ciphertext),
        }
    }
}

// ── Access guard ──────────────────────────────────────────────────────────────

/// Possession of a wrapped key is the sole access gate — purely cryptographic,
/// no server-side role checks.
async fn require_access(
    state: &AppState,
    collection_id: Uuid,
    user_id: Uuid,
) -> Result<(), ApiError> {
    let has_key = wrapped_key::Entity::find()
        .filter(wrapped_key::Column::CollectionId.eq(collection_id))
        .filter(wrapped_key::Column::UserId.eq(user_id))
        .count(&state.db)
        .await?
        > 0;

    if has_key { Ok(()) } else { Err(ApiError::Forbidden) }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

pub async fn list_entries(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(collection_id): Path<Uuid>,
) -> Result<Json<Vec<EntryDto>>, ApiError> {
    require_access(&state, collection_id, auth.user_id).await?;

    let entries = entry::Entity::find()
        .filter(entry::Column::CollectionId.eq(collection_id))
        .order_by_desc(entry::Column::CreatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(entries.into_iter().map(EntryDto::from).collect()))
}

pub async fn create_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateEntryRequest>,
) -> Result<(StatusCode, Json<EntryDto>), ApiError> {
    let ciphertext = BASE64
        .decode(&req.ciphertext)
        .map_err(|_| ApiError::BadRequest("invalid ciphertext encoding".into()))?;

    require_access(&state, req.collection_id, auth.user_id).await?;

    let model = entry::ActiveModel {
        id:            Set(Uuid::new_v4()),
        collection_id: Set(req.collection_id),
        ciphertext:    Set(ciphertext),
        ..Default::default()
    }
    .insert(&state.db)
    .await?;

    Ok((StatusCode::CREATED, Json(EntryDto::from(model))))
}

pub async fn get_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(entry_id): Path<Uuid>,
) -> Result<Json<EntryDto>, ApiError> {
    let model = entry::Entity::find_by_id(entry_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    require_access(&state, model.collection_id, auth.user_id).await?;

    Ok(Json(EntryDto::from(model)))
}

pub async fn update_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(entry_id): Path<Uuid>,
    Json(req): Json<UpdateEntryRequest>,
) -> Result<Json<EntryDto>, ApiError> {
    let ciphertext = BASE64
        .decode(&req.ciphertext)
        .map_err(|_| ApiError::BadRequest("invalid ciphertext encoding".into()))?;

    let existing = entry::Entity::find_by_id(entry_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    require_access(&state, existing.collection_id, auth.user_id).await?;

    if existing.version != req.expected_version {
        return Err(ApiError::Conflict(
            "version mismatch — fetch the latest entry and retry".into(),
        ));
    }

    let mut active = existing.into_active_model();
    active.ciphertext   = Set(ciphertext);
    active.version      = Set(req.expected_version + 1);
    active.updated_at   = Set(chrono::Utc::now().fixed_offset());

    let updated = active.update(&state.db).await?;
    Ok(Json(EntryDto::from(updated)))
}

pub async fn delete_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(entry_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let model = entry::Entity::find_by_id(entry_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    require_access(&state, model.collection_id, auth.user_id).await?;

    entry::Entity::delete_by_id(entry_id)
        .exec(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
