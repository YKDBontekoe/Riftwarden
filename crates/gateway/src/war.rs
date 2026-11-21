//! The shared Rift War behind the gateway (architecture v2 step 6). The gateway keeps the stored document,
//! advances it every 30 s and applies reports through the rules worker, persists it, and serves it:
//!   GET  /war         public snapshot `{war, online, now}` (cached between changes)
//!   POST /war/report  `{node, mode}` from a signed-in warden (rate limited per account)

use std::time::Duration;

use axum::{
    Json, Router,
    extract::State as Extract,
    http::header,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use riftwarden_proto::v1::{Doc, WarReport, WarRequest, worker_request, worker_response};
use serde::Deserialize;
use tokio::sync::Mutex;

use crate::{
    State,
    auth::session::Authed,
    error::{ApiError, ApiResult},
    limits::{ClientIp, hit},
};

const TICK: Duration = Duration::from_secs(30);

#[derive(Default)]
pub struct War {
    stored: Mutex<Option<Stored>>,
}

struct Stored {
    doc: serde_json::Value,
    /** The `war` part, serialized once per change. */
    war_json: String,
}

fn now_ms() -> f64 {
    chrono::Utc::now().timestamp_millis() as f64
}

impl War {
    async fn call(
        state: &State,
        doc: Option<&serde_json::Value>,
        report: Option<WarReport>,
    ) -> ApiResult<(serde_json::Value, bool, Option<serde_json::Value>)> {
        let seed =
            std::env::var("RIFT_WAR_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or_else(|| rand::random::<u32>() % (1 << 31) + 1);
        let req = WarRequest {
            stored: doc.map(|d| Doc { json: serde_json::to_vec(d).unwrap_or_default() }),
            now: now_ms(),
            online: state.hub.online() as u32,
            seed,
            report,
        };
        match state.workers.call(worker_request::Call::War(req)).await.map_err(ApiError::internal)? {
            worker_response::Result::War(r) => {
                let stored = serde_json::from_slice(&r.stored.unwrap_or_default().json).map_err(ApiError::internal)?;
                let report = r
                    .report
                    .filter(|d| !d.json.is_empty())
                    .map(|d| serde_json::from_slice(&d.json))
                    .transpose()
                    .map_err(ApiError::internal)?;
                Ok((stored, r.changed, report))
            }
            _ => Err(ApiError::internal("unexpected worker answer")),
        }
    }

    fn keep(slot: &mut Option<Stored>, doc: serde_json::Value) {
        let war_json = doc.get("war").map(|w| w.to_string()).unwrap_or_else(|| "null".into());
        *slot = Some(Stored { doc, war_json });
    }

    /// Load (or start) the war on first use, then advance it.
    pub async fn tick(&self, state: &State) -> ApiResult<()> {
        let mut slot = self.stored.lock().await;
        let loaded = match slot.as_ref() {
            Some(s) => Some(s.doc.clone()),
            None => riftwarden_db::war::load(&state.db).await?,
        };
        let fresh = slot.is_none();
        let (doc, changed, _) = Self::call(state, loaded.as_ref(), None).await?;
        if changed || fresh {
            riftwarden_db::war::save(&state.db, &doc).await?;
        }
        Self::keep(&mut slot, doc);
        Ok(())
    }

    pub async fn snapshot(&self, state: &State) -> ApiResult<String> {
        if self.stored.lock().await.is_none() {
            self.tick(state).await?;
        }
        let slot = self.stored.lock().await;
        let war = slot.as_ref().map(|s| s.war_json.as_str()).unwrap_or("null");
        Ok(format!(r#"{{"war":{war},"online":{},"now":{}}}"#, state.hub.online(), now_ms() as i64))
    }

    pub async fn report(&self, state: &State, report: WarReport) -> ApiResult<serde_json::Value> {
        if self.stored.lock().await.is_none() {
            self.tick(state).await?;
        }
        let mut slot = self.stored.lock().await;
        let current = slot.as_ref().map(|s| s.doc.clone());
        let (doc, changed, result) = Self::call(state, current.as_ref(), Some(report)).await?;
        if changed {
            riftwarden_db::war::save(&state.db, &doc).await?;
        }
        Self::keep(&mut slot, doc);
        Ok(result.unwrap_or(serde_json::json!({ "ok": false, "reason": "No result", "gain": 0, "lib": 0, "messages": [] })))
    }
}

/// Advance the war every 30 s (retries quietly while the worker is unreachable).
pub fn spawn_ticker(state: State) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(TICK);
        loop {
            tick.tick().await;
            if let Err(e) = state.war.tick(&state).await {
                tracing::warn!(error = %e.message, "war tick failed");
            }
        }
    });
}

pub fn routes() -> Router<State> {
    Router::new().route("/war", get(snapshot)).route("/war/report", post(report))
}

async fn snapshot(Extract(state): Extract<State>, ip: ClientIp) -> ApiResult<Response> {
    hit(&state, "war", &ip.0, 120, 60).await?;
    let body = state.war.snapshot(&state).await?;
    Ok(([(header::CONTENT_TYPE, "application/json"), (header::CACHE_CONTROL, "no-store")], body).into_response())
}

#[derive(Deserialize)]
struct ReportBody {
    node: String,
    #[serde(default)]
    mode: String,
}

/// A solo warden secured a sector. Signed-in wardens only (guests play on their local copy of the war).
async fn report(Extract(state): Extract<State>, auth: Authed, Json(b): Json<ReportBody>) -> ApiResult<Json<serde_json::Value>> {
    let who = auth.account.to_string();
    let gap = state.config.war_report_gap_s;
    if gap > 0 && hit(&state, "war-gap", &who, 1, gap).await.is_err() {
        return Ok(Json(
            serde_json::json!({ "ok": false, "reason": "Too soon: a sector takes five waves", "gain": 0, "lib": 0, "messages": [] }),
        ));
    }
    if hit(&state, "war-hour", &who, 40, 3600).await.is_err() {
        return Ok(Json(
            serde_json::json!({ "ok": false, "reason": "Report limit reached for this hour", "gain": 0, "lib": 0, "messages": [] }),
        ));
    }
    if b.node.len() > 16 {
        return Err(ApiError::bad("bad_node", "Unknown node"));
    }
    let mode = if b.mode == "survival" { "survival" } else { "defense" };
    let result = state.war.report(&state, WarReport { node: b.node, mode: mode.into(), players: 1, trusted: false }).await?;
    Ok(Json(result))
}
