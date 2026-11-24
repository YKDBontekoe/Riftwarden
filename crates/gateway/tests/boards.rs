//! Leaderboards: GET /boards reads the `board` summaries the rules keep on server profile documents (seasonal and
//! permanent). Skipped without the test database/Redis.

use axum::{
    body::Body,
    http::{Request, header},
};
use riftwarden_gateway::{Config, connect, router};
use serde_json::{Value, json};
use tower::ServiceExt;

async fn get(app: &axum::Router, uri: &str) -> (u16, Value) {
    let res = app
        .clone()
        .oneshot(Request::builder().uri(uri).header(header::ACCEPT, "application/json").body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = res.status().as_u16();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 22).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn warden(state: &riftwarden_gateway::State, tag: &str, doc: Value) -> String {
    let id = uuid::Uuid::new_v4();
    let name = format!("{tag}{}", &id.simple().to_string()[..6]);
    riftwarden_db::accounts::create_account(&state.db, id, &name, id.as_bytes(), &json!({}), "x").await.unwrap();
    sqlx::query("INSERT INTO profiles (account_id, doc, rev, rules_version) VALUES ($1, $2, 1, 11)")
        .bind(id)
        .bind(doc)
        .execute(&state.db)
        .await
        .unwrap();
    name
}

#[tokio::test]
async fn boards_rank_seasonal_and_permanent_progress() {
    let Some(db) = std::env::var("RIFT_TEST_DATABASE_URL").ok() else { return eprintln!("skipped") };
    let Some(redis) = std::env::var("RIFT_TEST_REDIS_URL").ok() else { return eprintln!("skipped") };
    let Ok(state) = connect(Config::for_tests(db, redis)).await else { return eprintln!("skipped") };
    // An isolated season id per run (other tests share the database).
    let season = 50_000 + (std::process::id() % 40_000) as i32;
    let board = |rl: i64, wave: i64| json!({ "rl": rl, "wave": wave, "waveRl": rl, "at": 0 });
    let a = warden(&state, "Ace", json!({ "board": board(30, 40), "seasonal": { "id": season, "doc": { "board": board(9, 20) } } })).await;
    let b = warden(&state, "Bee", json!({ "board": board(31, 12), "seasonal": { "id": season, "doc": { "board": board(12, 15) } } })).await;
    let c = warden(&state, "Cid", json!({ "seasonal": { "id": season + 1, "doc": { "board": board(99, 99) } } })).await;
    let _ = c;
    let app = router(state.clone());

    let (s, v) = get(&app, &format!("/boards?scope=season&season={season}&metric=rl")).await;
    assert_eq!(s, 200, "{v}");
    let names: Vec<&str> = v["rows"].as_array().unwrap().iter().map(|r| r["name"].as_str().unwrap()).collect();
    assert_eq!(names, vec![b.as_str(), a.as_str()], "another season's warden never appears: {v}");
    assert_eq!(v["rows"][0]["rl"], 12);

    let (_, v) = get(&app, &format!("/boards?scope=season&season={season}&metric=wave")).await;
    assert_eq!(v["rows"][0]["name"], a.as_str(), "deepest wave first: {v}");

    let (_, v) = get(&app, "/boards?scope=permanent&metric=rl").await;
    let rows = v["rows"].as_array().unwrap();
    let pos = |n: &str| rows.iter().position(|r| r["name"] == n);
    assert!(pos(&b).unwrap() < pos(&a).unwrap(), "{v}");
    assert!(pos(&c).is_none(), "a profile without a permanent board summary is not listed");

    let (s, _) = get(&app, "/boards?scope=season&season=0").await;
    assert_eq!(s, 400);
}
