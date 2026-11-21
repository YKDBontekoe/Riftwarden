//! Fixed-window rate limits in Redis (shared by every gateway instance) and the client address.

use std::net::{IpAddr, SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::request::Parts,
};

use crate::{State, error::ApiError};

/// Allow `max` hits per `window_s` seconds for `bucket:key`. Test servers multiply the allowance by 20.
pub async fn hit(state: &State, bucket: &str, key: &str, max: u32, window_s: u64) -> Result<(), ApiError> {
    let max = if state.config.test_mode { max * 20 } else { max };
    let k = format!("rw:rl:{bucket}:{key}");
    let mut r = state.redis.clone();
    let (n,): (u32,) = redis::pipe().atomic().incr(&k, 1).expire(&k, window_s as i64).ignore().query_async(&mut r).await?;
    if n > max { Err(ApiError::limited()) } else { Ok(()) }
}

/// The caller's address: `CF-Connecting-IP` behind the tunnel (when trusted), else the socket peer.
#[derive(Debug, Clone)]
pub struct ClientIp(pub String);

impl FromRequestParts<State> for ClientIp {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, state: &State) -> Result<Self, Self::Rejection> {
        if state.config.trust_cf_ip
            && let Some(ip) = parts.headers.get("cf-connecting-ip").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<IpAddr>().ok())
        {
            return Ok(Self(ip.to_string()));
        }
        let peer = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip().to_string());
        Ok(Self(peer.unwrap_or_else(|| "unknown".into())))
    }
}
