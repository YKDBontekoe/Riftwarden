//! Gateway configuration from the environment (12-factor; `.env` on the server is fine per the owner).

use std::net::SocketAddr;

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub listen: SocketAddr,
    pub database_url: String,
    pub database_max_connections: u32,
    pub redis_url: String,
    /// Git sha of this build (health + telemetry release tag).
    pub build: String,
    /// JSON logs (production) or human-readable (development).
    pub json_logs: bool,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        Ok(Self {
            listen: var("RIFT_LISTEN").unwrap_or_else(|| "0.0.0.0:8080".into()).parse().context("RIFT_LISTEN")?,
            database_url: var("DATABASE_URL").context("DATABASE_URL is required")?,
            database_max_connections: var("RIFT_DB_POOL").map(|v| v.parse()).transpose().context("RIFT_DB_POOL")?.unwrap_or(10),
            redis_url: var("REDIS_URL").unwrap_or_else(|| "redis://127.0.0.1:6379".into()),
            build: var("RIFT_BUILD").unwrap_or_else(|| "dev".into()),
            json_logs: var("RIFT_LOG_FORMAT").is_none_or(|v| v != "pretty"),
        })
    }
}
