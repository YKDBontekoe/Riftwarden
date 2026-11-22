//! PostgreSQL access for the gateway: connection pool, embedded migrations and queries.
//!
//! Game rules never live here: profile documents are stored as JSON owned by `packages/rules`.

pub mod accounts;
pub mod profiles;
pub mod war;

use std::time::Duration;

pub use sqlx::PgPool;
use sqlx::postgres::PgPoolOptions;

/// Migrations embedded at compile time (`crates/db/migrations`), applied on gateway start.
pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database: {0}")]
    Sqlx(#[from] sqlx::Error),
    #[error("migration: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),
    /// A unique constraint was violated (taken name, duplicate credential).
    #[error("conflict")]
    Conflict,
}

/// Connect a pool and bring the schema up to date.
pub async fn connect(url: &str, max_connections: u32) -> Result<PgPool, DbError> {
    let pool = PgPoolOptions::new().max_connections(max_connections).acquire_timeout(Duration::from_secs(5)).connect(url).await?;
    MIGRATOR.run(&pool).await?;
    tracing::info!(migrations = MIGRATOR.iter().count(), "database ready");
    Ok(pool)
}

/// Cheap liveness probe for `/health`.
pub async fn ping(pool: &PgPool) -> Result<(), DbError> {
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(())
}
