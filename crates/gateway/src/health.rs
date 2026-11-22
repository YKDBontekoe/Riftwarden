//! `/health`: liveness of the gateway and its dependencies (used by Docker and the deploy script).

use axum::{Json, Router, extract::State as Extract, http::StatusCode, routing::get};
use serde::Serialize;

use crate::State;

#[derive(Serialize)]
struct Health {
    ok: bool,
    build: String,
    db: bool,
    redis: bool,
    /// Connected sim workers, open rooms, running operations.
    sims: usize,
    rooms: usize,
    running: u32,
}

pub fn routes() -> Router<State> {
    Router::new().route("/health", get(health))
}

async fn health(Extract(state): Extract<State>) -> (StatusCode, Json<Health>) {
    let db = riftwarden_db::ping(&state.db).await.is_ok();
    let mut redis = state.redis.clone();
    let redis = redis::cmd("PING").query_async::<String>(&mut redis).await.is_ok();
    let ok = db && redis;
    let code = if ok { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE };
    let sims = state.coop.links.iter().filter(|l| l.up.load(std::sync::atomic::Ordering::Relaxed)).count();
    let (rooms, running) = state.coop.status();
    (code, Json(Health { ok, build: state.config.build.clone(), db, redis, sims, rooms, running }))
}
