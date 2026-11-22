//! Opaque session tokens: 32 random bytes in an HttpOnly cookie, stored as SHA-256 in PostgreSQL and
//! cached in Redis for a minute (so most requests skip the database).

use axum::{
    extract::FromRequestParts,
    http::{HeaderValue, header, request::Parts},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{Duration, Utc};
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{State, error::ApiError};

pub const COOKIE: &str = "rw_session";
pub const LIFETIME_DAYS: i64 = 30;
const CACHE_S: u64 = 60;

pub fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::fill(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

fn cache_key(hash: &[u8]) -> String {
    format!("rw:sess:{}", URL_SAFE_NO_PAD.encode(hash))
}

/// Starts a session for the account; returns the Set-Cookie header value and the stored token hash.
pub async fn start_with_hash(state: &State, account: Uuid, user_agent: &str) -> Result<(HeaderValue, Vec<u8>), ApiError> {
    let token = new_token();
    let hash = token_hash(&token);
    let expires = Utc::now() + Duration::days(LIFETIME_DAYS);
    riftwarden_db::accounts::create_session(&state.db, &hash, account, expires, &user_agent.chars().take(200).collect::<String>()).await?;
    Ok((cookie_header(state, &token, LIFETIME_DAYS * 86400)?, hash))
}

/// Starts a session for the account; returns the Set-Cookie header value.
pub async fn start(state: &State, account: Uuid, user_agent: &str) -> Result<HeaderValue, ApiError> {
    Ok(start_with_hash(state, account, user_agent).await?.0)
}

/// Signs the account out of every session except `keep` (after a recovery).
pub async fn end_others(state: &State, account: Uuid, keep: &[u8]) -> Result<(), ApiError> {
    let removed = riftwarden_db::accounts::delete_other_sessions(&state.db, account, keep).await?;
    if !removed.is_empty() {
        // Drop the cached lookups too, so the revocation is immediate.
        let mut r = state.redis.clone();
        let _: () = r.del(removed.iter().map(|h| cache_key(h)).collect::<Vec<_>>()).await?;
    }
    Ok(())
}

/// A cookie that clears the session in the browser.
pub fn clear_header(state: &State) -> Result<HeaderValue, ApiError> {
    cookie_header(state, "", 0)
}

fn cookie_header(state: &State, value: &str, max_age_s: i64) -> Result<HeaderValue, ApiError> {
    let mut c = Cookie::build((COOKIE, value.to_owned()))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .path("/")
        .max_age(time::Duration::seconds(max_age_s));
    if let Some(d) = &state.config.cookie_domain {
        c = c.domain(d.clone());
    }
    HeaderValue::from_str(&c.build().to_string()).map_err(ApiError::internal)
}

/// Resolves the session cookie to an account id (None when absent or expired).
pub async fn account_of(state: &State, jar: &CookieJar) -> Result<Option<(Uuid, Vec<u8>)>, ApiError> {
    let Some(token) = jar.get(COOKIE).map(|c| c.value().to_owned()).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    let hash = token_hash(&token);
    let mut r = state.redis.clone();
    let key = cache_key(&hash);
    if let Some(id) = r.get::<_, Option<String>>(&key).await?.and_then(|s| Uuid::parse_str(&s).ok()) {
        return Ok(Some((id, hash)));
    }
    let id = riftwarden_db::accounts::session_account(&state.db, &hash, Utc::now() + Duration::days(LIFETIME_DAYS)).await?;
    if let Some(id) = id {
        let _: () = r.set_ex(&key, id.to_string(), CACHE_S).await?;
        return Ok(Some((id, hash)));
    }
    Ok(None)
}

pub async fn end(state: &State, hash: &[u8]) -> Result<(), ApiError> {
    riftwarden_db::accounts::delete_session(&state.db, hash).await?;
    let mut r = state.redis.clone();
    let _: () = r.del(cache_key(hash)).await?;
    Ok(())
}

/// Extractor for endpoints that need a signed-in account.
pub struct Authed {
    pub account: Uuid,
    pub token_hash: Vec<u8>,
}

impl axum::extract::OptionalFromRequestParts<State> for Authed {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &State) -> Result<Option<Self>, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        Ok(account_of(state, &jar).await?.map(|(account, token_hash)| Self { account, token_hash }))
    }
}

impl FromRequestParts<State> for Authed {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &State) -> Result<Self, Self::Rejection> {
        let jar = CookieJar::from_headers(&parts.headers);
        match account_of(state, &jar).await? {
            Some((account, token_hash)) => Ok(Self { account, token_hash }),
            None => Err(ApiError::unauthorized()),
        }
    }
}

pub fn user_agent(parts_headers: &axum::http::HeaderMap) -> String {
    parts_headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).unwrap_or("").to_owned()
}
