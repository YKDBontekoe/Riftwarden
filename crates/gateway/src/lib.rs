//! Riftwarden gateway: the only public backend service (see docs/architecture/architecture-v2.md).
//! The binary (`main.rs`) only wires configuration, telemetry and shutdown around [`router`].

pub mod admin;
pub mod auth;
pub mod boards;
pub mod config;
pub mod coop;
pub mod error;
mod health;
pub mod limits;
pub mod rooms;
pub mod session;
pub mod sync;
pub mod telemetry;
pub mod war;
pub mod workers;

use std::sync::Arc;

use anyhow::{Context, Result};
use axum::Router;

pub use config::Config;

/// Shared state for every handler.
pub struct AppState {
    pub config: Config,
    pub db: riftwarden_db::PgPool,
    pub redis: redis::aio::ConnectionManager,
    pub webauthn: webauthn_rs::Webauthn,
    pub workers: workers::Workers,
    pub hub: sync::Hub,
    pub war: war::War,
    pub coop: coop::Coop,
}

pub type State = Arc<AppState>;

pub fn router(state: State) -> Router {
    use axum::http::{Method, header};
    use tower_http::cors::{AllowOrigin, CorsLayer};
    use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};
    let origins: Vec<_> = state.config.client_origins.iter().filter_map(|o| o.origin().ascii_serialization().parse().ok()).collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE]);
    let traced = Router::new()
        .merge(auth::routes())
        .merge(session::routes())
        .merge(war::routes())
        .merge(boards::routes())
        .merge(rooms::routes())
        .layer(cors)
        .layer(
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
    let webauthn = auth::webauthn(&config)?;
    let workers = workers::Workers::new(&config.rules_workers, 2);
    let config_sims = config.sim_workers.clone();
    Ok(Arc::new(AppState {
        config,
        db,
        redis,
        webauthn,
        workers,
        hub: sync::Hub::default(),
        war: war::War::default(),
        coop: coop::Coop::new(&config_sims),
    }))
}

/// Background housekeeping: purge expired sessions every hour, advance the war every 30 s.
pub fn spawn_maintenance(state: State) {
    war::spawn_ticker(state.clone());
    coop::spawn(state.clone());
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
        loop {
            tick.tick().await;
            match riftwarden_db::accounts::purge_expired_sessions(&state.db).await {
                Ok(n) if n > 0 => tracing::info!(removed = n, "expired sessions purged"),
                Ok(_) => {}
                Err(e) => tracing::warn!(error = %e, "session purge failed"),
            }
        }
    });
}
