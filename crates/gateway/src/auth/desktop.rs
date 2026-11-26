//! A short-lived, proof-bound browser approval for desktop clients.
use axum::{
    Json,
    extract::State as Extract,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::session::{self, Authed};
use crate::{
    State,
    error::{ApiError, ApiResult},
    limits::{ClientIp, hit},
};

#[derive(Deserialize)]
pub struct Begin {
    challenge: String,
}
#[derive(Deserialize)]
pub struct Approve {
    id: String,
}
#[derive(Deserialize)]
pub struct Poll {
    id: String,
    verifier: String,
}
#[derive(Serialize, Deserialize)]
struct Request {
    challenge: String,
    account: Option<Uuid>,
}
#[derive(Serialize)]
pub struct Started {
    id: String,
}
#[derive(Serialize)]
pub struct Completed {
    cookie: String,
}

fn valid(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub async fn begin(Extract(state): Extract<State>, ip: ClientIp, Json(body): Json<Begin>) -> ApiResult<Json<Started>> {
    hit(&state, "desktop_begin", &ip.0, 15, 60).await?;
    if !valid(&body.challenge) {
        return Err(ApiError::bad("invalid_request", "Invalid request"));
    }
    let id = session::new_token();
    let request = Request { challenge: body.challenge, account: None };
    let mut redis = state.redis.clone();
    let _: () = redis.set_ex(format!("rw:desktop:{id}"), serde_json::to_string(&request).map_err(ApiError::internal)?, 300).await?;
    Ok(Json(Started { id }))
}

pub async fn approve(Extract(state): Extract<State>, auth: Authed, ip: ClientIp, Json(body): Json<Approve>) -> ApiResult<StatusCode> {
    hit(&state, "desktop_approve", &ip.0, 20, 60).await?;
    if !valid(&body.id) {
        return Err(ApiError::bad("invalid_request", "Invalid request"));
    }
    let mut redis = state.redis.clone();
    let key = format!("rw:desktop:{}", body.id);
    // Keep the original expiry and allow just one approval.
    let script = redis::Script::new(
        r#"local v=redis.call('GET',KEYS[1]); if not v then return 0 end; local r=cjson.decode(v); if r.account ~= cjson.null then return 0 end; r.account=ARGV[1]; redis.call('SET',KEYS[1],cjson.encode(r),'KEEPTTL'); return 1"#,
    );
    let updated: i32 = script.key(key).arg(auth.account.to_string()).invoke_async(&mut redis).await?;
    if updated == 0 {
        return Err(ApiError::bad("expired", "This sign-in request has expired"));
    }
    Ok(StatusCode::NO_CONTENT)
}

pub async fn poll(Extract(state): Extract<State>, ip: ClientIp, headers: HeaderMap, Json(body): Json<Poll>) -> ApiResult<Response> {
    hit(&state, "desktop_poll", &ip.0, 120, 60).await?;
    if !valid(&body.id) || !valid(&body.verifier) {
        return Err(ApiError::bad("invalid_request", "Invalid request"));
    }
    let mut redis = state.redis.clone();
    let key = format!("rw:desktop:{}", body.id);
    let raw: Option<String> = redis.get(&key).await?;
    let raw = raw.ok_or_else(|| ApiError::bad("expired", "This sign-in request has expired"))?;
    let request: Request = serde_json::from_str(&raw).map_err(ApiError::internal)?;
    if URL_SAFE_NO_PAD.encode(Sha256::digest(body.verifier.as_bytes())) != request.challenge {
        return Err(ApiError::unauthorized());
    }
    if request.account.is_none() {
        return Ok(StatusCode::ACCEPTED.into_response());
    }
    let taken: Option<String> = redis::cmd("GETDEL").arg(&key).query_async(&mut redis).await?;
    if taken.is_none() {
        return Err(ApiError::bad("expired", "This sign-in request has expired"));
    }
    let cookie = session::start(&state, request.account.expect("approved"), &session::user_agent(&headers)).await?;
    Ok(Json(Completed { cookie: cookie.to_str().map_err(ApiError::internal)?.to_owned() }).into_response())
}
