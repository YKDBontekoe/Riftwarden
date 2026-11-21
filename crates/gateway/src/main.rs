//! Gateway binary: configuration, telemetry, serve, graceful shutdown.

use anyhow::{Context, Result};
use riftwarden_gateway::{Config, connect, router, spawn_maintenance, telemetry::Telemetry};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;
    let telemetry = Telemetry::init(config.json_logs, &config.build)?;
    tracing::info!(build = %config.build, listen = %config.listen, "gateway starting");

    let state = connect(config).await?;
    spawn_maintenance(state.clone());
    let listener = TcpListener::bind(state.config.listen).await.context("bind")?;
    axum::serve(listener, router(state).into_make_service_with_connect_info::<std::net::SocketAddr>())
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    tracing::info!("gateway stopped");
    telemetry.shutdown();
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
