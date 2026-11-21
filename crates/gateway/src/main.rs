//! Riftwarden gateway: the only public backend service (see docs/architecture-v2.md).

mod config;
mod health;

use std::sync::Arc;

use anyhow::{Context, Result};
use axum::Router;
use tokio::net::TcpListener;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

pub use config::Config;

/// Shared state for every handler.
pub struct AppState {
    pub config: Config,
    pub db: riftwarden_db::PgPool,
    pub redis: redis::aio::ConnectionManager,
}

pub type State = Arc<AppState>;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;
    init_tracing(config.json_logs);
    tracing::info!(build = %config.build, listen = %config.listen, "gateway starting");

    let db = riftwarden_db::connect(&config.database_url, config.database_max_connections).await.context("PostgreSQL")?;
    let redis = redis::Client::open(config.redis_url.as_str()).context("REDIS_URL")?.get_connection_manager().await.context("Redis")?;
    let state = Arc::new(AppState { config, db, redis });

    let app = router(state.clone());
    let listener = TcpListener::bind(state.config.listen).await.context("bind")?;
    axum::serve(listener, app).with_graceful_shutdown(shutdown_signal()).await?;
    tracing::info!("gateway stopped");
    Ok(())
}

pub fn router(state: State) -> Router {
    Router::new().merge(health::routes()).layer(tower_http::trace::TraceLayer::new_for_http()).with_state(state)
}

fn init_tracing(json: bool) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,tower_http=info,sqlx=warn"));
    let registry = tracing_subscriber::registry().with(filter);
    if json {
        registry.with(tracing_subscriber::fmt::layer().json().flatten_event(true)).init();
    } else {
        registry.with(tracing_subscriber::fmt::layer()).init();
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutdown signal received");
}
