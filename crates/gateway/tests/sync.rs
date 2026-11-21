//! Profile sync through a real rules worker (apps/worker, started here with `node --import tsx`).
//! Skipped without RIFT_TEST_DATABASE_URL / RIFT_TEST_REDIS_URL or without the repository's node_modules.

use std::{path::PathBuf, process::Stdio, time::Duration};

use riftwarden_gateway::{Config, State, connect, sync};
use riftwarden_proto::v1::{Doc, SyncEntry, SyncRequest};
use serde_json::{Value, json};
use uuid::Uuid;

struct Worker(std::process::Child);
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.0.kill();
    }
}

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

async fn setup() -> Option<(State, Worker)> {
    let mut cfg = Config::for_tests(std::env::var("RIFT_TEST_DATABASE_URL").ok()?, std::env::var("RIFT_TEST_REDIS_URL").ok()?);
    if !repo().join("node_modules/tsx").exists() {
        eprintln!("skipped: run pnpm install for the worker");
        return None;
    }
    let port = 17_000 + (std::process::id() % 2000) as u16;
    let child = std::process::Command::new("node")
        .args(["--import", "tsx", "apps/worker/src/main.ts"])
        .env("RIFT_WORKER_LISTEN", format!("127.0.0.1:{port}"))
        .current_dir(repo())
        .stdout(Stdio::null())
        .spawn()
        .ok()?;
    let worker = Worker(child);
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    cfg.rules_workers = vec![format!("127.0.0.1:{port}")];
    Some((connect(cfg).await.ok()?, worker))
}

async fn account(state: &State) -> Uuid {
    let id = Uuid::new_v4();
    let name = format!("Sync{}", &id.simple().to_string()[..8]);
    riftwarden_db::accounts::create_account(&state.db, id, &name, id.as_bytes(), &json!({}), "x").await.unwrap();
    id
}

fn entry(seq: u64, body: Value) -> SyncEntry {
    SyncEntry { seq, at: 1.8e12, body: Some(Doc { json: serde_json::to_vec(&body).unwrap() }) }
}

fn doc(r: &riftwarden_proto::v1::SyncResult) -> Value {
    serde_json::from_slice(&r.doc.as_ref().unwrap().json).unwrap()
}

#[tokio::test]
async fn sync_replays_dedupes_claims_and_rejects() {
    let Some((state, _worker)) = setup().await else { return };

    // A new account: the server makes a fresh profile and applies the device's entries.
    let a = account(&state).await;
    let req = SyncRequest {
        device: "dev-a".into(),
        entries: vec![
            entry(1, json!({ "op": { "name": "tutorialSkip", "args": [] } })),
            entry(2, json!({ "op": { "name": "noSuchOp", "args": [] } })),
        ],
        genesis: None,
    };
    let r = sync::sync(&state, a, 1, req.clone()).await.unwrap();
    assert_eq!(r.rev, 1);
    assert_eq!(r.results.iter().map(|x| x.ok).collect::<Vec<_>>(), [true, false]);
    assert_eq!(doc(&r)["tutorial"]["skipped"], true);

    // Re-sending the same entries (lost answer) applies nothing twice.
    let again = sync::sync(&state, a, 1, req).await.unwrap();
    assert_eq!(again.rev, 1);
    assert!(again.results.iter().all(|x| x.ok && x.reason == "already applied"));

    // A run bank for a run that never started is refused; the profile stays.
    let bad = SyncRequest {
        device: "dev-a".into(),
        entries: vec![entry(
            3,
            json!({ "run": { "kind": "bank", "runId": "run_none", "wave": 5, "bosses": 0, "loot": [],
            "rewards": { "salvage": 0, "credits": 999999, "components": 0, "shards": 0, "xp": 0, "items": [] } } }),
        )],
        genesis: None,
    };
    let r = sync::sync(&state, a, 1, bad).await.unwrap();
    assert!(!r.results[0].ok && r.results[0].reason.contains("no such run"), "{:?}", r.results);
    assert_eq!(r.rev, 1, "nothing applied, no new revision");

    // A guest profile is adopted by an account without a profile (its genesis is a fresh default).
    let genesis =
        doc(&sync::sync(&state, account(&state).await, 2, SyncRequest { device: "probe".into(), entries: vec![], genesis: None })
            .await
            .unwrap());
    let b = account(&state).await;
    let claim = SyncRequest {
        device: "guest-b".into(),
        entries: vec![entry(1, json!({ "op": { "name": "tutorialSkip", "args": [] } }))],
        genesis: Some(Doc { json: serde_json::to_vec(&genesis).unwrap() }),
    };
    let r = sync::sync(&state, b, 3, claim.clone()).await.unwrap();
    assert!(r.claimed);
    assert_eq!(doc(&r)["profile"]["id"], genesis["profile"]["id"]);
    assert_eq!(doc(&r)["tutorial"]["skipped"], true);

    // ...but never into an account that already has one.
    let r = sync::sync(&state, b, 3, SyncRequest { device: "guest-b2".into(), ..claim }).await.unwrap();
    assert!(!r.claimed && r.results.iter().all(|x| !x.ok));

    // An edited genesis is refused: the account starts fresh instead.
    let mut rich = genesis.clone();
    rich["resources"]["credits"] = json!(5_000_000);
    let c = account(&state).await;
    let r = sync::sync(
        &state,
        c,
        4,
        SyncRequest { device: "guest-c".into(), entries: vec![], genesis: Some(Doc { json: serde_json::to_vec(&rich).unwrap() }) },
    )
    .await
    .unwrap();
    assert!(!r.claimed);
    assert_ne!(doc(&r)["resources"]["credits"], json!(5_000_000));
}
