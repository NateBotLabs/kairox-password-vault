use anyhow::Context;
use kairox_api::{build_router, migration::Migrator, AppState};
use sea_orm::Database;
use sea_orm_migration::MigratorTrait;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kairox_api=info,tower_http=info".into()),
        )
        .init();

    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL").context("DATABASE_URL must be set")?;
    let jwt_secret   = std::env::var("JWT_SECRET").context("JWT_SECRET must be set")?;
    let bind_addr    = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());

    let db = Database::connect(&database_url)
        .await
        .context("failed to connect to database")?;

    Migrator::up(&db, None)
        .await
        .context("failed to run database migrations")?;

    tracing::info!("migrations applied");

    let state = AppState { db, jwt_secret };
    let app   = build_router(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("listening on {bind_addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
