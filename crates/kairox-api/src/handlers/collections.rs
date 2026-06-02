use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use sea_orm::{
    sea_query::OnConflict, ActiveModelTrait, ColumnTrait, EntityTrait, JoinType,
    QueryFilter, QueryOrder, QuerySelect, RelationTrait, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::{
    entity::{collection, wrapped_key},
    error::ApiError,
    jwt::AuthUser,
    state::AppState,
};

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateCollectionRequest {
    /// base64(keywrap::wrap_key(owner_public, collection_key, collection_id))
    /// Client generates a random CollectionKey and wraps it for themselves.
    pub wrapped_key: String,
    /// Optional client-supplied UUID. When provided (e.g. by the desktop app),
    /// the collection is stored under this ID so the client can use it as AAD
    /// when wrapping the key BEFORE the round-trip to the server.
    pub collection_id: Option<Uuid>,
}

#[derive(Serialize)]
pub struct CollectionDto {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

impl From<collection::Model> for CollectionDto {
    fn from(m: collection::Model) -> Self {
        CollectionDto {
            id:         m.id,
            owner_id:   m.owner_id,
            created_at: m.created_at.with_timezone(&chrono::Utc),
        }
    }
}

#[derive(Deserialize)]
pub struct AddWrappedKeyRequest {
    pub user_id: Uuid,
    pub key_version: i32,
    /// base64(keywrap::wrap_key(target_user_public, collection_key, collection_id))
    pub wrapped_key: String,
}

#[derive(Serialize)]
pub struct WrappedKeyDto {
    pub collection_id: Uuid,
    pub user_id: Uuid,
    pub key_version: i32,
    pub wrapped_key: String,  // base64
}

impl From<wrapped_key::Model> for WrappedKeyDto {
    fn from(m: wrapped_key::Model) -> Self {
        WrappedKeyDto {
            collection_id: m.collection_id,
            user_id:       m.user_id,
            key_version:   m.key_version,
            wrapped_key:   BASE64.encode(&m.wrapped_bytes),
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn require_owner(
    state: &AppState,
    collection_id: Uuid,
    user_id: Uuid,
) -> Result<collection::Model, ApiError> {
    let col = collection::Entity::find_by_id(collection_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;
    if col.owner_id != user_id {
        return Err(ApiError::Forbidden);
    }
    Ok(col)
}

// ── Handlers ──────────────────────────────────────────────────────────────────

pub async fn create_collection(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(req): Json<CreateCollectionRequest>,
) -> Result<(StatusCode, Json<CollectionDto>), ApiError> {
    let wrapped_bytes = BASE64
        .decode(&req.wrapped_key)
        .map_err(|_| ApiError::BadRequest("invalid wrapped_key encoding".into()))?;

    let collection_id = req.collection_id.unwrap_or_else(Uuid::new_v4);

    // Insert collection + owner's wrapped key atomically
    state.db
        .transaction::<_, (), sea_orm::DbErr>(|txn| {
            let col = collection::ActiveModel {
                id:       Set(collection_id),
                owner_id: Set(auth.user_id),
                ..Default::default()
            };
            let wk = wrapped_key::ActiveModel {
                collection_id: Set(collection_id),
                user_id:       Set(auth.user_id),
                key_version:   Set(1),
                wrapped_bytes: Set(wrapped_bytes.clone()),
                ..Default::default()
            };
            Box::pin(async move {
                col.insert(txn).await?;
                wk.insert(txn).await?;
                Ok(())
            })
        })
        .await?;

    let col = collection::Entity::find_by_id(collection_id)
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    Ok((StatusCode::CREATED, Json(CollectionDto::from(col))))
}

pub async fn list_collections(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<CollectionDto>>, ApiError> {
    let cols = collection::Entity::find()
        .join(JoinType::InnerJoin, collection::Relation::WrappedKey.def())
        .filter(wrapped_key::Column::UserId.eq(auth.user_id))
        .order_by_desc(collection::Column::CreatedAt)
        .all(&state.db)
        .await?;

    Ok(Json(cols.into_iter().map(CollectionDto::from).collect()))
}

/// Return the calling user's wrapped key for a collection so they can
/// recover the Collection Key locally.
pub async fn get_wrapped_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(collection_id): Path<Uuid>,
) -> Result<Json<WrappedKeyDto>, ApiError> {
    let wk = wrapped_key::Entity::find()
        .filter(wrapped_key::Column::CollectionId.eq(collection_id))
        .filter(wrapped_key::Column::UserId.eq(auth.user_id))
        .one(&state.db)
        .await?
        .ok_or(ApiError::NotFound)?;

    Ok(Json(WrappedKeyDto::from(wk)))
}

/// Grant another user access by storing their wrapped key (owner only).
pub async fn add_wrapped_key(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(collection_id): Path<Uuid>,
    Json(req): Json<AddWrappedKeyRequest>,
) -> Result<StatusCode, ApiError> {
    let wrapped_bytes = BASE64
        .decode(&req.wrapped_key)
        .map_err(|_| ApiError::BadRequest("invalid wrapped_key encoding".into()))?;

    require_owner(&state, collection_id, auth.user_id).await?;

    wrapped_key::Entity::insert(wrapped_key::ActiveModel {
        collection_id: Set(collection_id),
        user_id:       Set(req.user_id),
        key_version:   Set(req.key_version),
        wrapped_bytes: Set(wrapped_bytes),
        ..Default::default()
    })
    .on_conflict(
        OnConflict::columns([wrapped_key::Column::CollectionId, wrapped_key::Column::UserId])
            .update_columns([wrapped_key::Column::KeyVersion, wrapped_key::Column::WrappedBytes])
            .to_owned(),
    )
    .exec(&state.db)
    .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Remove a member's access (owner only).
/// The owner should rotate the Collection Key after revoking.
pub async fn revoke_access(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((collection_id, user_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    require_owner(&state, collection_id, auth.user_id).await?;

    wrapped_key::Entity::delete_many()
        .filter(wrapped_key::Column::CollectionId.eq(collection_id))
        .filter(wrapped_key::Column::UserId.eq(user_id))
        .exec(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
