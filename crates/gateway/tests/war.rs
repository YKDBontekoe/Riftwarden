//! The shared war behind the gateway, with a real rules worker. Skipped without the test database/Redis or
//! the repository's node_modules.

use std::{path::PathBuf, process::Stdio, time::Duration};

use axum::{
    body::Body,
    http::{Request, header},
};
use riftwarden_gateway::{Config, connect, router};
use serde_json::{Value, json};
use tower::ServiceExt;

struct Worker(std::process::Child);
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}

async fn setup() -> Option<(riftwarden_gateway::State, Worker)> {
    let mut cfg = Config::for_tests(std::env::var("RIFT_TEST_DATABASE_URL").ok()?, std::env::var("RIFT_TEST_REDIS_URL").ok()?);
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    if !repo.join("node_modules/tsx").exists() {
        return None;
    }
    let port = 19_000 + (std::process::id() % 2000) as u16;
    let child = std::process::Command::new("node")
        .args(["--import", "tsx", "apps/worker/src/main.ts"])
        .env("RIFT_WORKER_LISTEN", format!("127.0.0.1:{port}"))
        .current_dir(&repo)
        .stdout(Stdio::null())
        .spawn()
        .ok()?;
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    cfg.rules_workers = vec![format!("127.0.0.1:{port}")];
    let state = connect(cfg).await.ok()?;
    // A clean war for this test.
    sqlx::query("DELETE FROM war_state").execute(&state.db).await.ok()?;
    Some((state, Worker(child)))
}

async fn call(app: &axum::Router, method: &str, uri: &str, body: Option<Value>, cookie: Option<&str>) -> (u16, Value) {
    let mut req = Request::builder().method(method).uri(uri);
    if body.is_some() {
        req = req.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let res = app.clone().oneshot(req.body(body.map(|b| Body::from(b.to_string())).unwrap_or_default()).unwrap()).await.unwrap();
    let status = res.status().as_u16();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

#[tokio::test]
async fn war_snapshot_reports_and_persistence() {
    let Some((state, _worker)) = setup().await else { return eprintln!("skipped") };
    let app = router(state.clone());

    // The first look starts a war and stores it.
    let (s, v) = call(&app, "GET", "/war", None, None).await;
    assert_eq!(s, 200, "{v}");
    let seed = v["war"]["seed"].as_u64().unwrap();
    assert!(v["now"].as_i64().is_some() && v["online"].is_number());
    let stored = riftwarden_db::war::load(&state.db).await.unwrap().unwrap();
    assert_eq!(stored["war"]["seed"].as_u64(), Some(seed));

    // Reports need a signed-in warden.
    let (s, _) = call(&app, "POST", "/war/report", Some(json!({ "node": "r0n0", "mode": "defense" })), None).await;
    assert_eq!(s, 401);
    let id = uuid::Uuid::new_v4();
    riftwarden_db::accounts::create_account(
        &state.db,
        id,
        &format!("War{}", &id.simple().to_string()[..8]),
        id.as_bytes(),
        &json!({}),
        "x",
    )
    .await
    .unwrap();
    let cookie = riftwarden_gateway::auth::session::start(&state, id, "test").await.unwrap();
    let cookie = cookie.to_str().unwrap().split(';').next().unwrap().to_owned();

    // The landing sector is a combat sector of the first region: securing it liberates.
    let (s, r) = call(&app, "POST", "/war/report", Some(json!({ "node": "r0n0", "mode": "defense" })), Some(&cookie)).await;
    assert_eq!(s, 200, "{r}");
    assert_eq!(r["ok"], true, "{r}");
    assert!(r["gain"].as_f64().unwrap() > 0.0);
    // Unknown or locked sectors are refused.
    let (_, r) = call(&app, "POST", "/war/report", Some(json!({ "node": "r9n0", "mode": "defense" })), Some(&cookie)).await;
    assert_eq!(r["ok"], false);

    // The liberation is persisted and visible in the snapshot.
    let (_, v) = call(&app, "GET", "/war", None, None).await;
    assert!(v["war"]["secured"].as_u64().unwrap() >= 1, "{}", v["war"]["secured"]);
    let stored = riftwarden_db::war::load(&state.db).await.unwrap().unwrap();
    assert_eq!(stored["war"]["secured"], v["war"]["secured"]);
}
