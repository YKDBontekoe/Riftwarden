//! Operator endpoints on a separate listener that is never published (`RIFT_ADMIN_LISTEN`, default
//! 127.0.0.1:9090 inside the container). The deploy script reaches them with `riftwarden-gateway admin ...`
//! through `docker compose exec`, so the distroless image needs no shell or curl.
//!
//!   GET  /status                       sim workers (address, connected, draining, running operations), rooms
//!   POST /drain?worker=ADDR&on=1|0     stop (or resume) new rooms on one sim worker; running operations finish

use std::sync::atomic::Ordering;

use axum::{
    Json, Router,
    extract::{Query, State as Extract},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};

use crate::State;

#[derive(Serialize)]
struct WorkerStatus {
    addr: String,
    up: bool,
    draining: bool,
    running: u32,
}

#[derive(Serialize)]
struct Status {
    build: String,
    rooms: usize,
    running: u32,
    sims: Vec<WorkerStatus>,
}

#[derive(Deserialize)]
struct DrainQuery {
    worker: String,
    #[serde(default = "yes")]
    on: u8,
}

fn yes() -> u8 {
    1
}

pub fn router(state: State) -> Router {
    Router::new().route("/status", get(status)).route("/drain", post(drain)).with_state(state)
}

async fn status(Extract(state): Extract<State>) -> Json<Status> {
    let (rooms, running) = state.coop.status();
    let sims = state
        .coop
        .links
        .iter()
        .map(|l| WorkerStatus {
            addr: l.addr.clone(),
            up: l.up.load(Ordering::Relaxed),
            draining: l.draining.load(Ordering::Relaxed),
            running: l.running.load(Ordering::Relaxed),
        })
        .collect();
    Json(Status { build: state.config.build.clone(), rooms, running, sims })
}

async fn drain(Extract(state): Extract<State>, Query(q): Query<DrainQuery>) -> Result<StatusCode, (StatusCode, String)> {
    if state.coop.drain_one(&q.worker, q.on != 0) {
        tracing::info!(worker = %q.worker, on = q.on != 0, "sim worker drain");
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err((StatusCode::NOT_FOUND, format!("no sim worker {}", q.worker)))
    }
}

/// Tiny HTTP/1.1 client for the CLI subcommands (plain http to the local listeners only).
pub async fn request(addr: &str, method: &str, path: &str) -> anyhow::Result<(u16, String)> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut s = tokio::time::timeout(std::time::Duration::from_secs(3), tokio::net::TcpStream::connect(addr)).await??;
    let req = format!("{method} {path} HTTP/1.1\r\nHost: {addr}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    s.write_all(req.as_bytes()).await?;
    let mut buf = Vec::new();
    tokio::time::timeout(std::time::Duration::from_secs(5), s.read_to_end(&mut buf)).await??;
    let text = String::from_utf8_lossy(&buf);
    let code = text.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let body = text.split_once("\r\n\r\n").map(|(_, b)| b.to_owned()).unwrap_or_default();
    Ok((code, body))
}
