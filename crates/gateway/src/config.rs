//! Gateway configuration from the environment (12-factor; `.env` on the server is fine per the owner).

use std::net::SocketAddr;

use anyhow::{Context, Result};
use url::Url;

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
    /// WebAuthn relying party id (the client's registrable domain, e.g. `riftwarden.ykdbonte.dev`).
    pub rp_id: String,
    /// Origins allowed to run passkey ceremonies and call the API with credentials (the client's origins).
    pub client_origins: Vec<Url>,
    /// `Secure` session cookies (off only for plain-http local development).
    pub cookie_secure: bool,
    /// Cookie domain shared by the client and the API (e.g. `.riftwarden.ykdbonte.dev`); none = host-only.
    pub cookie_domain: Option<String>,
    /// Take the client address from `CF-Connecting-IP` (behind the Cloudflare tunnel).
    pub trust_cf_ip: bool,
    /// Test servers: relaxed rate limits.
    pub test_mode: bool,
    /// Rules worker addresses (apps/worker, role rules).
    pub rules_workers: Vec<String>,
    /// Minimum seconds between two war reports of one warden (0 = off, for tests).
    pub war_report_gap_s: u64,
    /// Sim worker addresses (apps/worker, role sim).
    pub sim_workers: Vec<String>,
    /// Operator listener (admin.rs); never published outside the container.
    pub admin_listen: std::net::SocketAddr,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let var = |k: &str| std::env::var(k).ok().filter(|v| !v.is_empty());
        let origins = var("RIFT_CLIENT_ORIGINS").unwrap_or_else(|| "http://localhost:5173".into());
        let client_origins =
            origins.split(',').map(|o| Url::parse(o.trim()).with_context(|| format!("RIFT_CLIENT_ORIGINS: {o}"))).collect::<Result<_>>()?;
        Ok(Self {
            listen: var("RIFT_LISTEN").unwrap_or_else(|| "0.0.0.0:8080".into()).parse().context("RIFT_LISTEN")?,
            database_url: var("DATABASE_URL").context("DATABASE_URL is required")?,
            database_max_connections: var("RIFT_DB_POOL").map(|v| v.parse()).transpose().context("RIFT_DB_POOL")?.unwrap_or(10),
            redis_url: var("REDIS_URL").unwrap_or_else(|| "redis://127.0.0.1:6379".into()),
            build: var("RIFT_BUILD").unwrap_or_else(|| "dev".into()),
            json_logs: var("RIFT_LOG_FORMAT").is_none_or(|v| v != "pretty"),
            rp_id: var("RIFT_RP_ID").unwrap_or_else(|| "localhost".into()),
            client_origins,
            cookie_secure: var("RIFT_COOKIE_SECURE").is_none_or(|v| v != "0"),
            cookie_domain: var("RIFT_COOKIE_DOMAIN"),
            trust_cf_ip: var("RIFT_TRUST_CF_IP").is_some_and(|v| v == "1"),
            test_mode: var("RIFT_TEST").is_some_and(|v| v == "1"),
            sim_workers: var("RIFT_SIM_WORKERS")
                .unwrap_or_else(|| "127.0.0.1:7201".into())
                .split(',')
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .collect(),
            admin_listen: var("RIFT_ADMIN_LISTEN").unwrap_or_else(|| "127.0.0.1:9090".into()).parse().context("RIFT_ADMIN_LISTEN")?,
            war_report_gap_s: var("RIFT_WAR_GAP_S").map(|v| v.parse()).transpose().context("RIFT_WAR_GAP_S")?.unwrap_or(45),
            rules_workers: var("RIFT_RULES_WORKERS")
                .unwrap_or_else(|| "127.0.0.1:7101".into())
                .split(',')
                .map(|s| s.trim().to_owned())
                .filter(|s| !s.is_empty())
                .collect(),
        })
    }

    /// A local configuration for integration tests (plain http on localhost).
    pub fn for_tests(database_url: String, redis_url: String) -> Self {
        Self {
            listen: "127.0.0.1:0".parse().expect("addr"),
            database_url,
            database_max_connections: 4,
            redis_url,
            build: "test".into(),
            json_logs: false,
            rp_id: "localhost".into(),
            client_origins: vec![Url::parse("http://localhost:5173").expect("url")],
            cookie_secure: false,
            cookie_domain: None,
            trust_cf_ip: false,
            test_mode: true,
            war_report_gap_s: 0,
            sim_workers: Vec::new(),
            admin_listen: "127.0.0.1:0".parse().expect("addr"),
            rules_workers: std::env::var("RIFT_TEST_WORKER").map(|w| vec![w]).unwrap_or_default(),
        }
    }
}
