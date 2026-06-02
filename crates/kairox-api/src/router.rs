use axum::{
    routing::{delete, get, post},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use crate::{
    handlers::{auth, collections, entries, users},
    state::AppState,
};

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any);

    Router::new()
        // ── Health ──────────────────────────────────────────────────────
        .route("/health", get(|| async { "ok" }))
        // ── Auth ────────────────────────────────────────────────────────
        .route("/api/v1/auth/salt",     get(auth::get_salt))
        .route("/api/v1/auth/register", post(auth::register))
        .route("/api/v1/auth/login",    post(auth::login))
        // ── Users ───────────────────────────────────────────────────────
        .route("/api/v1/users/me",             get(users::me))
        .route("/api/v1/users/:id/public-key", get(users::public_key))
        // ── Collections ─────────────────────────────────────────────────
        .route(
            "/api/v1/collections",
            get(collections::list_collections).post(collections::create_collection),
        )
        .route("/api/v1/collections/:id/wrapped-key",  get(collections::get_wrapped_key))
        .route("/api/v1/collections/:id/wrapped-keys", post(collections::add_wrapped_key))
        .route(
            "/api/v1/collections/:collection_id/members/:user_id",
            delete(collections::revoke_access),
        )
        // ── Entries ─────────────────────────────────────────────────────
        .route("/api/v1/collections/:id/entries", get(entries::list_entries))
        .route("/api/v1/entries",                 post(entries::create_entry))
        .route(
            "/api/v1/entries/:id",
            get(entries::get_entry)
                .put(entries::update_entry)
                .delete(entries::delete_entry),
        )
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}
