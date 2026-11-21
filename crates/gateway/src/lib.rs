//! Riftwarden gateway: the only public backend service (see docs/architecture-v2.md).
//! The binary (`main.rs`) only wires configuration, telemetry and shutdown around [`router`].

pub mod config;
mod health;
pub mod telemetry;

use std::sync::Arc;

use anyhow::{Context, Result};
use axum::Router;

pub use config::Config;

/// Shared state for every handler.
pub struct AppState {
    pub config: Config,
    pub db: riftwarden_db::PgPool,
    pub redis: redis::aio::ConnectionManager,
}

pub type State = Arc<AppState>;

pub fn router(state: State) -> Router {
    use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
    let traced = Router::new().layer(
        TraceLayer::new_for_http()
            .make_span_with(DefaultMakeSpan::new().level(tracing::Level::INFO))
            .on_response(DefaultOnResponse::new().level(tracing::Level::INFO)),
    );
    // Health checks (Docker polls every few seconds) stay out of the traces.
    traced.merge(health::routes()).with_state(state)
}

/// Connect every dependency and build the shared state.
pub async fn connect(config: Config) -> Result<State> {
    let db = riftwarden_db::connect(&config.database_url, config.database_max_connections).await.context("PostgreSQL")?;
    let redis = redis::Client::open(config.redis_url.as_str()).context("REDIS_URL")?.get_connection_manager().await.context("Redis")?;
    Ok(Arc::new(AppState { config, db, redis }))
}
