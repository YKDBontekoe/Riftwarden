//! Leaderboards (progression design: seasons + permanent ladder):
//!   GET /boards?scope=season|permanent&season=N&metric=rl|wave   top 50 wardens
//! Only server documents count: guest profiles never reach a board, solo runs were validated by the rules worker.

use axum::{
    Json, Router,
    extract::{Query, State as Extract},
    routing::get,
};
use riftwarden_db::boards::{Metric, Scope, top};
use serde::Deserialize;

use crate::{
    State,
    error::{ApiError, ApiResult},
    limits::{ClientIp, hit},
};

#[derive(Deserialize)]
struct BoardQuery {
    #[serde(default)]
    scope: String,
    #[serde(default)]
    season: i32,
    #[serde(default)]
    metric: String,
}

pub fn routes() -> Router<State> {
    Router::new().route("/boards", get(boards))
}

async fn boards(Extract(state): Extract<State>, ip: ClientIp, Query(q): Query<BoardQuery>) -> ApiResult<Json<serde_json::Value>> {
    hit(&state, "boards", &ip.0, 60, 60).await?;
    let scope = match q.scope.as_str() {
        "season" if (1..100_000).contains(&q.season) => Scope::Season(q.season),
        "season" => return Err(ApiError::bad("bad_season", "Unknown season")),
        _ => Scope::Permanent,
    };
    let metric = if q.metric == "wave" { Metric::Wave } else { Metric::RiftLevel };
    let rows = top(&state.db, scope, metric, 50).await?;
    Ok(Json(
        serde_json::json!({ "rows": rows, "scope": if matches!(scope, Scope::Permanent) { "permanent" } else { "season" }, "season": q.season, "metric": if metric == Metric::Wave { "wave" } else { "rl" } }),
    ))
}
