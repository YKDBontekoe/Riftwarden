//! Integration tests against real PostgreSQL and Redis. Skipped unless RIFT_TEST_DATABASE_URL and
//! RIFT_TEST_REDIS_URL are set (CI provides both as services).

use axum::{body::Body, http::Request};
use riftwarden_gateway::{Config, connect, router};
use tower::ServiceExt;

fn test_config() -> Option<Config> {
    let database_url = std::env::var("RIFT_TEST_DATABASE_URL").ok()?;
    let redis_url = std::env::var("RIFT_TEST_REDIS_URL").ok()?;
    Some(Config {
        listen: "127.0.0.1:0".parse().unwrap(),
        database_url,
        database_max_connections: 2,
        redis_url,
        build: "test".into(),
        json_logs: false,
    })
}

#[tokio::test]
async fn health_reports_dependencies() {
    let Some(config) = test_config() else {
        eprintln!("skipped: RIFT_TEST_DATABASE_URL / RIFT_TEST_REDIS_URL not set");
        return;
    };
    let state = connect(config).await.expect("connect");
    let res = router(state).oneshot(Request::get("/health").body(Body::empty()).unwrap()).await.unwrap();
    assert_eq!(res.status(), 200);
    let body = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["ok"], true);
    assert_eq!(v["db"], true);
    assert_eq!(v["redis"], true);
    assert_eq!(v["build"], "test");
}
