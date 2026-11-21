//! Gateway binary: configuration, telemetry, serve, graceful shutdown. Subcommands for the container
//! (distroless: no shell or curl):
//!   riftwarden-gateway health                    exit 0 when /health is ok (Docker healthcheck)
//!   riftwarden-gateway admin status              sim workers and rooms (JSON)
//!   riftwarden-gateway admin drain ADDR on|off   stop / resume new rooms on one sim worker

use anyhow::{Context, Result, bail};
use riftwarden_gateway::{Config, admin, connect, router, spawn_maintenance, telemetry::Telemetry};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("health") => return health().await,
        Some("admin") => return admin_cli(&args[1..]).await,
        Some(other) => bail!("unknown command {other} (health | admin status | admin drain ADDR on|off)"),
        None => {}
    }
    let config = Config::from_env()?;
    let telemetry = Telemetry::init(config.json_logs, &config.build)?;
    tracing::info!(build = %config.build, listen = %config.listen, admin = %config.admin_listen, "gateway starting");

    let state = connect(config).await?;
    spawn_maintenance(state.clone());
    let listener = TcpListener::bind(state.config.listen).await.context("bind")?;
    let admin_listener = TcpListener::bind(state.config.admin_listen).await.context("bind admin")?;
    let admin_app = admin::router(state.clone());
    tokio::spawn(async move {
        if let Err(e) = axum::serve(admin_listener, admin_app).await {
            tracing::error!(error = %e, "admin listener stopped");
        }
    });
    axum::serve(listener, router(state).into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("gateway stopped");
    telemetry.shutdown();
    Ok(())
}

fn local(addr: &str, default: &str) -> String {
    let a = std::env::var(addr).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.into());
    // A wildcard bind is reached through loopback.
    a.replace("0.0.0.0", "127.0.0.1")
}

async fn health() -> Result<()> {
    let (code, body) = admin::request(&local("RIFT_LISTEN", "0.0.0.0:8080"), "GET", "/health").await?;
    if code != 200 {
        bail!("unhealthy ({code}): {body}");
    }
    Ok(())
}

async fn admin_cli(args: &[String]) -> Result<()> {
    let addr = local("RIFT_ADMIN_LISTEN", "127.0.0.1:9090");
    let (method, path) = match args.iter().map(String::as_str).collect::<Vec<_>>().as_slice() {
        ["status"] => ("GET", "/status".to_owned()),
        ["drain", worker, on] => ("POST", format!("/drain?worker={worker}&on={}", if *on == "off" { 0 } else { 1 })),
        _ => bail!("usage: admin status | admin drain ADDR on|off"),
    };
    let (code, body) = admin::request(&addr, method, &path).await?;
    println!("{body}");
    if !(200..300).contains(&code) {
        bail!("admin {path}: {code}");
    }
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let term = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let term = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = term => {} }
    tracing::info!("shutdown signal received");
}
