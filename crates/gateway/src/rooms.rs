//! Open-squad browser: GET /rooms lists co-op lobbies whose host listed them and that still have room.
//! The sim workers report their listed squads with every load update (coop.rs keeps them per worker), so the
//! list is at most a second or two old. Joining still goes through the normal `join {code}` co-op frame.

use axum::{Json, Router, extract::State as Extract, routing::get};

use crate::{
    State,
    error::ApiResult,
    limits::{ClientIp, hit},
};

/// Rows per response (the browser shows a page; codes still join any private squad).
const LIMIT: usize = 40;

pub fn routes() -> Router<State> {
    Router::new().route("/rooms", get(rooms))
}

async fn rooms(Extract(state): Extract<State>, ip: ClientIp) -> ApiResult<Json<serde_json::Value>> {
    hit(&state, "rooms", &ip.0, 120, 60).await?;
    let rows: Vec<serde_json::Value> = state
        .coop
        .open_squads(LIMIT)
        .into_iter()
        .map(|r| {
            let mode = if r.mode == riftwarden_proto::v1::GameMode::Survival as i32 { "survival" } else { "defense" };
            serde_json::json!({ "code": r.code, "host": r.host, "players": r.players, "capacity": r.capacity, "tier": r.tier, "mode": mode })
        })
        .collect();
    Ok(Json(serde_json::json!({ "rooms": rows })))
}
