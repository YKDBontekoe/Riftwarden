//! Offline-first profile sync (architecture v2 section 7): a device sends its pending log entries, the rules
//! worker replays them on the server copy (validating run entries), the result is stored and returned, and
//! the account's other sessions are told to refresh. One sync per account at a time (row lock).

use std::{
    collections::HashMap,
    sync::{
        Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

use riftwarden_proto::v1::{Doc, EntryResult, ReplayRequest, SyncRequest, SyncResult, worker_request, worker_response};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{State, error::ApiError, workers::WorkerError};

const MAX_ENTRIES: usize = 5000;

/// Profile change notices per account (in process: one gateway). `(connection id, new revision)`.
#[derive(Default)]
pub struct Hub {
    channels: Mutex<HashMap<Uuid, broadcast::Sender<(u64, i64)>>>,
    ids: AtomicU64,
}

impl Hub {
    pub fn connection_id(&self) -> u64 {
        self.ids.fetch_add(1, Ordering::Relaxed) + 1
    }
    pub fn subscribe(&self, account: Uuid) -> broadcast::Receiver<(u64, i64)> {
        let mut map = self.channels.lock().expect("hub");
        map.retain(|_, tx| tx.receiver_count() > 0);
        map.entry(account).or_insert_with(|| broadcast::channel(16).0).subscribe()
    }
    /// Open session sockets (the war's population sample).
    pub fn online(&self) -> usize {
        self.channels.lock().expect("hub").values().map(|tx| tx.receiver_count()).sum()
    }
    pub fn notify(&self, account: Uuid, from: u64, rev: i64) {
        if let Some(tx) = self.channels.lock().expect("hub").get(&account) {
            let _ = tx.send((from, rev));
        }
    }
}

fn doc_json(doc: &Option<Doc>) -> Result<Option<serde_json::Value>, ApiError> {
    match doc {
        Some(d) if !d.json.is_empty() => {
            serde_json::from_slice(&d.json).map(Some).map_err(|_| ApiError::bad("bad_document", "Unreadable document"))
        }
        _ => Ok(None),
    }
}

fn to_doc(v: &serde_json::Value) -> Result<Doc, ApiError> {
    Ok(Doc { json: serde_json::to_vec(v).map_err(ApiError::internal)? })
}

/// Run one sync for `account` from connection `conn`.
pub async fn sync(state: &State, account: Uuid, conn: u64, req: SyncRequest) -> Result<SyncResult, ApiError> {
    apply(state, account, conn, req, false).await
}

/// Entries from a co-op operation the server simulated (applied without run validation).
pub async fn apply_trusted(
    state: &State,
    account: Uuid,
    device: String,
    entries: Vec<riftwarden_proto::v1::SyncEntry>,
) -> Result<SyncResult, ApiError> {
    apply(state, account, 0, SyncRequest { device, entries, genesis: None }, true).await
}

async fn apply(state: &State, account: Uuid, conn: u64, req: SyncRequest, trusted: bool) -> Result<SyncResult, ApiError> {
    if req.device.is_empty() || req.device.len() > 64 {
        return Err(ApiError::bad("bad_device", "Missing device id"));
    }
    if req.entries.len() > MAX_ENTRIES {
        return Err(ApiError::bad("too_many_entries", "Too many entries in one sync"));
    }
    let mut tx = state.db.begin().await.map_err(ApiError::internal)?;
    let current = riftwarden_db::profiles::lock(&mut tx, account).await?;
    let last = riftwarden_db::profiles::device_seq(&mut tx, account, &req.device).await?;
    let claim = req.genesis.as_ref().is_some_and(|g| !g.json.is_empty());

    // A guest upload only applies to an account without a profile; otherwise the guest log is not this account's.
    let (doc, genesis, entries, claimed) = match (&current, claim) {
        (Some((doc, _)), true) => (Some(doc.clone()), None, Vec::new(), false),
        (Some((doc, _)), false) => (Some(doc.clone()), None, req.entries.iter().filter(|e| e.seq as i64 > last).cloned().collect(), false),
        (None, true) => (None, req.genesis.clone(), req.entries.clone(), true),
        (None, false) => (None, None, req.entries.iter().filter(|e| e.seq as i64 > last).cloned().collect(), false),
    };

    let replay = ReplayRequest {
        doc: doc.as_ref().map(to_doc).transpose()?,
        genesis,
        entries,
        now: chrono::Utc::now().timestamp_millis() as f64,
        trusted,
    };
    let (result, claimed) = match state.workers.call(worker_request::Call::Replay(replay.clone())).await {
        Ok(worker_response::Result::Replay(r)) => (r, claimed),
        Ok(_) => return Err(ApiError::internal("unexpected worker answer")),
        Err(e) if claimed && e.downcast_ref::<WorkerError>().is_some() => {
            // The guest genesis was refused: the account starts from a fresh profile, the guest log stays local.
            tracing::warn!(account = %account, error = %e, "guest profile refused");
            let fallback = ReplayRequest { doc: None, genesis: None, entries: Vec::new(), now: replay.now, trusted: false };
            match state.workers.call(worker_request::Call::Replay(fallback)).await.map_err(ApiError::internal)? {
                worker_response::Result::Replay(r) => (r, false),
                _ => return Err(ApiError::internal("unexpected worker answer")),
            }
        }
        Err(e) => return Err(ApiError::internal(e)),
    };

    let new_doc = doc_json(&result.doc)?.ok_or_else(|| ApiError::internal("worker returned no document"))?;
    let changed = current.is_none() || result.applied > 0;
    let rev = if changed {
        riftwarden_db::profiles::store(&mut tx, account, &new_doc, result.rules_version as i32).await?
    } else {
        current.as_ref().map(|(_, r)| *r).unwrap_or(0)
    };
    // Advance the device position past everything it sent (rejected entries are final too) unless the
    // entries were a guest log that this account did not adopt.
    if !(claim && !claimed)
        && let Some(max) = req.entries.iter().map(|e| e.seq).max()
    {
        riftwarden_db::profiles::set_device_seq(&mut tx, account, &req.device, max as i64).await?;
    }
    tx.commit().await.map_err(ApiError::internal)?;
    if changed {
        state.hub.notify(account, conn, rev);
        // Sim workers holding this player get the new copy (their own trusted entries are already in theirs).
        if !trusted {
            state.coop.profile_changed(account, &new_doc);
        }
    }

    // Results for every sent entry: replayed ones from the worker, earlier ones were already applied.
    let mut by_seq: HashMap<u64, EntryResult> = result.results.into_iter().map(|r| (r.seq, r)).collect();
    let results = req
        .entries
        .iter()
        .map(|e| {
            by_seq.remove(&e.seq).unwrap_or_else(|| EntryResult {
                seq: e.seq,
                ok: !(claim && !claimed),
                reason: if claim && !claimed { "the account already has a profile".into() } else { "already applied".into() },
            })
        })
        .collect();
    tracing::info!(account = %account, rev, entries = req.entries.len(), applied = result.applied, claimed, "profile synced");
    Ok(SyncResult { rev, doc: Some(to_doc(&new_doc)?), results, claimed })
}

/// Days an account must exist before it may trade (economy/trade.ts `TRADE.accountDays`; checked here because
/// the profile's own creation time comes from the device).
const TRADE_ACCOUNT_DAYS: i64 = 7;

/// Apply both sides of a warden-to-warden trade in one transaction: either both profiles change or neither.
/// Each side is one trusted `{trade}` entry on the log device `trade:<id>`, so a repeated request applies nothing.
pub async fn apply_trade(state: &State, id: &str, a: Uuid, b: Uuid, entry_a: Doc, entry_b: Doc) -> Result<(), ApiError> {
    if a == b || id.is_empty() || id.len() > 48 {
        return Err(ApiError::bad("bad_trade", "Malformed trade"));
    }
    if !state.config.test_mode {
        for acc in [a, b] {
            let created = riftwarden_db::accounts::account_by_id(&state.db, acc).await?.map(|x| x.created_at);
            if created.is_none_or(|c| chrono::Utc::now() - c < chrono::Duration::days(TRADE_ACCOUNT_DAYS)) {
                return Err(ApiError::bad("trade_gate", "Trading opens 7 days after an account is created"));
            }
        }
    }
    let device = format!("trade:{id}");
    let mut tx = state.db.begin().await.map_err(ApiError::internal)?;
    // Lock in a fixed order so two trades between the same wardens cannot deadlock.
    let mut sides = [(a, entry_a), (b, entry_b)];
    sides.sort_by_key(|(acc, _)| *acc);
    let mut stored = Vec::new();
    for (acc, entry) in sides {
        let Some((doc, _)) = riftwarden_db::profiles::lock(&mut tx, acc).await? else {
            return Err(ApiError::bad("trade_profile", "A warden has no profile"));
        };
        if riftwarden_db::profiles::device_seq(&mut tx, acc, &device).await? >= 1 {
            return Err(ApiError::bad("trade_done", "This trade was already applied"));
        }
        let replay = ReplayRequest {
            doc: Some(to_doc(&doc)?),
            genesis: None,
            entries: vec![riftwarden_proto::v1::SyncEntry { seq: 1, at: chrono::Utc::now().timestamp_millis() as f64, body: Some(entry) }],
            now: chrono::Utc::now().timestamp_millis() as f64,
            trusted: true,
        };
        let result = match state.workers.call(worker_request::Call::Replay(replay)).await.map_err(ApiError::internal)? {
            worker_response::Result::Replay(r) => r,
            _ => return Err(ApiError::internal("unexpected worker answer")),
        };
        if let Some(bad) = result.results.iter().find(|r| !r.ok) {
            // Dropping the transaction rolls back the other side too.
            return Err(ApiError::bad("trade_refused", bad.reason.clone()));
        }
        let new_doc = doc_json(&result.doc)?.ok_or_else(|| ApiError::internal("worker returned no document"))?;
        let rev = riftwarden_db::profiles::store(&mut tx, acc, &new_doc, result.rules_version as i32).await?;
        riftwarden_db::profiles::set_device_seq(&mut tx, acc, &device, 1).await?;
        stored.push((acc, rev, new_doc));
    }
    tx.commit().await.map_err(ApiError::internal)?;
    for (acc, rev, doc) in stored {
        // Devices rebase on the new copy; the sim worker (which only proposed the trade) gets it too.
        state.hub.notify(acc, 0, rev);
        state.coop.profile_changed(acc, &doc);
    }
    tracing::info!(trade = %id, a = %a, b = %b, "trade applied");
    Ok(())
}
