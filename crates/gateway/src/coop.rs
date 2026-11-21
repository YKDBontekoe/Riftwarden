//! Co-op through the gateway (architecture v2 step 7). Sim workers (apps/worker, role sim) run lobbies and
//! operations; the gateway authenticates players, routes their co-op frames (tunnelled on the session socket)
//! to the worker that holds their room, keeps the room directory, sends profiles, applies the operations' run
//! entries (trusted), forwards their war reports and pushes the war.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU32, Ordering},
    },
    time::Duration,
};

use prost::Message;
use riftwarden_proto::v1::{
    ClientFrame, Doc, Error as ProtoError, Pong, ServerFrame, SimAttach, SimDown, SimEntries, SimInput, SimProfile, SimUp, SyncEntry,
    WarReport, client_frame, server_frame, sim_down, sim_up,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::mpsc,
};
use uuid::Uuid;

use crate::State;

const MAX_FRAME: usize = 16 * 1024 * 1024;

pub struct SimLink {
    pub addr: String,
    tx: mpsc::UnboundedSender<Vec<u8>>,
    rx: tokio::sync::Mutex<Option<mpsc::UnboundedReceiver<Vec<u8>>>>,
    pub up: AtomicBool,
    pub draining: AtomicBool,
    pub capacity: AtomicU32,
    pub running: AtomicU32,
    /// Accounts whose profile this worker has (sent before their first frame).
    attached: Mutex<HashSet<Uuid>>,
}

#[derive(Default)]
struct Directory {
    /// Open room code -> worker.
    rooms: HashMap<String, usize>,
    /// Account -> worker holding its room.
    accounts: HashMap<Uuid, usize>,
}

type ClientTx = mpsc::UnboundedSender<Vec<u8>>;

pub struct Coop {
    pub links: Vec<Arc<SimLink>>,
    dir: Mutex<Directory>,
    /// The session connection that speaks co-op for each account.
    clients: Mutex<HashMap<Uuid, (u64, ClientTx)>>,
    /// Run entries from the workers, applied in arrival order (a bank must never overtake its start).
    entries: mpsc::UnboundedSender<SimEntries>,
    entries_rx: Mutex<Option<mpsc::UnboundedReceiver<SimEntries>>>,
}

fn down(msg: sim_down::Msg) -> Vec<u8> {
    SimDown { msg: Some(msg) }.encode_to_vec()
}

fn server_frame(msg: server_frame::Msg) -> Vec<u8> {
    ServerFrame { msg: Some(msg) }.encode_to_vec()
}

fn error_frame(code: &str, msg: &str) -> Vec<u8> {
    server_frame(server_frame::Msg::Error(ProtoError { code: code.into(), msg: msg.into() }))
}

/// Room codes as players type them (case-insensitive, separators ignored).
pub fn normalize_code(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).take(8).collect()
}

impl Coop {
    pub fn new(addrs: &[String]) -> Self {
        let links = addrs
            .iter()
            .map(|a| {
                let (tx, rx) = mpsc::unbounded_channel();
                Arc::new(SimLink {
                    addr: a.clone(),
                    tx,
                    rx: tokio::sync::Mutex::new(Some(rx)),
                    up: AtomicBool::new(false),
                    draining: AtomicBool::new(false),
                    capacity: AtomicU32::new(6),
                    running: AtomicU32::new(0),
                    attached: Mutex::new(HashSet::new()),
                })
            })
            .collect();
        let (entries, entries_rx) = mpsc::unbounded_channel();
        Self {
            links,
            dir: Mutex::new(Directory::default()),
            clients: Mutex::new(HashMap::new()),
            entries,
            entries_rx: Mutex::new(Some(entries_rx)),
        }
    }

    /// Workers that accept new rooms, least loaded first.
    fn pick(&self) -> Option<usize> {
        self.links
            .iter()
            .enumerate()
            .filter(|(_, l)| l.up.load(Ordering::Relaxed) && !l.draining.load(Ordering::Relaxed))
            .min_by_key(|(_, l)| l.running.load(Ordering::Relaxed))
            .map(|(i, _)| i)
    }

    fn reply(&self, account: Uuid, frame: Vec<u8>) {
        if let Some((_, tx)) = self.clients.lock().expect("clients").get(&account) {
            let _ = tx.send(frame);
        }
    }

    /// A co-op frame from a signed-in player's session connection `conn`.
    pub async fn from_client(&self, state: &State, account: Uuid, name: &str, conn: u64, tx: &ClientTx, bytes: Vec<u8>) {
        // This connection now speaks co-op for the account (a second window replaces the first).
        let replaced = {
            let mut c = self.clients.lock().expect("clients");
            let old = c.insert(account, (conn, tx.clone()));
            old.filter(|(id, _)| *id != conn).map(|(_, t)| t)
        };
        if let Some(old) = replaced {
            let _ = old.send(error_frame("replaced", "Signed in from another window"));
        }
        let Ok(frame) = ClientFrame::decode(bytes.as_slice()) else {
            return self.reply(account, error_frame("malformed", "Unreadable message"));
        };
        // Pings are answered here (round-trip time to the gateway).
        if let Some(client_frame::Msg::Ping(p)) = &frame.msg {
            return self
                .reply(account, server_frame(server_frame::Msg::Pong(Pong { c: p.c, s: chrono::Utc::now().timestamp_millis() as f64 })));
        }
        let bound = self.dir.lock().expect("dir").accounts.get(&account).copied();
        let target = match &frame.msg {
            Some(client_frame::Msg::Join(j)) => match self.dir.lock().expect("dir").rooms.get(&normalize_code(&j.code)).copied() {
                Some(w) => Some(w),
                None => return self.reply(account, error_frame("join", "No session with that code")),
            },
            _ => bound.or_else(|| self.pick()),
        };
        let Some(target) = target else {
            return self.reply(account, error_frame("offline", "Co-op servers are unavailable, try again shortly"));
        };
        // Joining a room on another worker: leave the old one first.
        if let Some(old) = bound.filter(|b| *b != target) {
            let leave = ClientFrame { msg: Some(client_frame::Msg::Leave(Default::default())) }.encode_to_vec();
            let _ = self.links[old].tx.send(down(sim_down::Msg::Input(SimInput { account: account.to_string(), frame: leave })));
        }
        let link = &self.links[target];
        let needs_attach = !link.attached.lock().expect("attached").contains(&account);
        if needs_attach {
            let profile = match riftwarden_db::profiles::get(&state.db, account).await {
                Ok(Some((doc, _))) => doc,
                Ok(None) => {
                    return self.reply(account, error_frame("profile", "Your profile has not synced yet: open ACCOUNT in the main menu"));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "profile load for co-op failed");
                    return self.reply(account, error_frame("server", "Server error"));
                }
            };
            let doc = Doc { json: serde_json::to_vec(&profile).unwrap_or_default() };
            let _ = link.tx.send(down(sim_down::Msg::Attach(SimAttach {
                account: account.to_string(),
                name: name.into(),
                profile: Some(doc),
            })));
            link.attached.lock().expect("attached").insert(account);
        }
        let _ = link.tx.send(down(sim_down::Msg::Input(SimInput { account: account.to_string(), frame: bytes })));
    }

    /// The session connection closed: the worker keeps the player's slot for the reconnect window.
    pub fn detach(&self, account: Uuid, conn: u64) {
        let mine = {
            let mut c = self.clients.lock().expect("clients");
            if c.get(&account).is_some_and(|(id, _)| *id == conn) {
                c.remove(&account);
                true
            } else {
                false
            }
        };
        if !mine {
            return;
        }
        for link in &self.links {
            if link.attached.lock().expect("attached").remove(&account) {
                let _ = link.tx.send(down(sim_down::Msg::Detach(account.to_string())));
            }
        }
    }

    /// An account's profile changed outside the workers (a sync from a device).
    pub fn profile_changed(&self, account: Uuid, doc: &serde_json::Value) {
        for link in &self.links {
            if link.attached.lock().expect("attached").contains(&account) {
                let profile = Doc { json: serde_json::to_vec(doc).unwrap_or_default() };
                let _ = link.tx.send(down(sim_down::Msg::Profile(SimProfile { account: account.to_string(), profile: Some(profile) })));
            }
        }
    }

    /// The war changed: every worker gets the new state.
    pub fn war_changed(&self, war_json: &str) {
        for link in &self.links {
            let _ = link.tx.send(down(sim_down::Msg::War(Doc { json: war_json.as_bytes().to_vec() })));
        }
    }

    /// Draining (deploys): workers finish running operations and open no new rooms.
    pub fn drain(&self, on: bool) {
        for link in &self.links {
            link.draining.store(on, Ordering::Relaxed);
            let _ = link.tx.send(down(sim_down::Msg::Drain(on)));
        }
    }

    /// Drain (or resume) one sim worker by address; false when no such worker is configured.
    pub fn drain_one(&self, addr: &str, on: bool) -> bool {
        let Some(link) = self.links.iter().find(|l| l.addr == addr) else { return false };
        link.draining.store(on, Ordering::Relaxed);
        let _ = link.tx.send(down(sim_down::Msg::Drain(on)));
        true
    }

    /// Open rooms and running operations (health / metrics).
    pub fn status(&self) -> (usize, u32) {
        let rooms = self.dir.lock().expect("dir").rooms.len();
        (rooms, self.links.iter().map(|l| l.running.load(Ordering::Relaxed)).sum())
    }

    async fn on_up(&self, state: &State, idx: usize, up: SimUp) {
        match up.msg {
            Some(sim_up::Msg::Hello(h)) => {
                self.links[idx].capacity.store(h.capacity, Ordering::Relaxed);
                tracing::info!(worker = %self.links[idx].addr, build = %h.build, capacity = h.capacity, "sim worker ready");
            }
            Some(sim_up::Msg::Output(o)) => {
                let clients = self.clients.lock().expect("clients");
                for a in &o.accounts {
                    if let Some((_, tx)) = Uuid::parse_str(a).ok().and_then(|id| clients.get(&id)) {
                        let _ = tx.send(o.frame.clone());
                    }
                }
            }
            Some(sim_up::Msg::Entries(e)) => {
                let _ = self.entries.send(e);
            }
            Some(sim_up::Msg::Report(r)) => {
                let state = state.clone();
                tokio::spawn(async move {
                    let rep = WarReport { trusted: true, ..r };
                    if let Err(e) = state.war.report(&state, rep).await {
                        tracing::warn!(error = %e.message, "co-op war report failed");
                    }
                });
            }
            Some(sim_up::Msg::Bind(b)) => {
                let Ok(account) = Uuid::parse_str(&b.account) else { return };
                let mut dir = self.dir.lock().expect("dir");
                if b.code.is_empty() {
                    if dir.accounts.get(&account) == Some(&idx) {
                        dir.accounts.remove(&account);
                    }
                } else {
                    dir.accounts.insert(account, idx);
                }
            }
            Some(sim_up::Msg::Load(l)) => {
                self.links[idx].running.store(l.running, Ordering::Relaxed);
                let mut dir = self.dir.lock().expect("dir");
                dir.rooms.retain(|_, w| *w != idx);
                for c in l.codes {
                    dir.rooms.insert(c, idx);
                }
            }
            None => {}
        }
    }

    /// A worker went away: its rooms and bindings are gone; tell its players and record their operations as
    /// interrupted (secured rewards stay, the rest is lost, as after a closed tab).
    fn lost(&self, state: &State, idx: usize) {
        let accounts: Vec<Uuid> = {
            let mut dir = self.dir.lock().expect("dir");
            dir.rooms.retain(|_, w| *w != idx);
            let gone: Vec<Uuid> = dir.accounts.iter().filter(|(_, w)| **w == idx).map(|(a, _)| *a).collect();
            for a in &gone {
                dir.accounts.remove(a);
            }
            gone
        };
        self.links[idx].attached.lock().expect("attached").clear();
        for a in &accounts {
            self.reply(*a, error_frame("server", "The co-op server restarted: the operation was lost (banked rewards are safe)"));
            self.reply(*a, server_frame(server_frame::Msg::Lobby(Default::default())));
        }
        let state = state.clone();
        tokio::spawn(async move {
            for account in accounts {
                if let Err(e) = interrupt_operation(&state, account).await {
                    tracing::warn!(account = %account, error = %e, "could not close a lost operation");
                }
            }
        });
    }
}

/// Queue an `interrupt` entry on the operation's own log when the account's active run came from a sim worker.
async fn interrupt_operation(state: &State, account: Uuid) -> anyhow::Result<()> {
    let Some((doc, _)) = riftwarden_db::profiles::get(&state.db, account).await? else { return Ok(()) };
    let Some(run) = doc.pointer("/activeRun/id").and_then(|v| v.as_str()) else { return Ok(()) };
    let device: String = format!("op:{run}").chars().take(64).collect();
    let seq = {
        let mut conn = state.db.acquire().await?;
        riftwarden_db::profiles::device_seq(&mut conn, account, &device).await?
    };
    if seq == 0 {
        return Ok(()); // a run of the player's own device, not an operation
    }
    let at = chrono::Utc::now().timestamp_millis() as f64;
    let body = serde_json::json!({ "run": { "kind": "interrupt", "at": at } });
    let entry = SyncEntry { seq: seq as u64 + 1, at, body: Some(Doc { json: serde_json::to_vec(&body)? }) };
    let _ = state.coop.entries.send(SimEntries { account: account.to_string(), device, entries: vec![entry] });
    Ok(())
}

async fn exchange(state: &State, idx: usize, link: &SimLink, rx: &mut mpsc::UnboundedReceiver<Vec<u8>>) -> anyhow::Result<()> {
    let stream = TcpStream::connect(&link.addr).await?;
    stream.set_nodelay(true).ok();
    let (mut reader, mut writer) = stream.into_split();
    link.up.store(true, Ordering::Relaxed);
    // A (re)connected worker needs its drain state, the war and fresh profile attachments. The first frame also
    // tells the worker that this connection is the gateway (health probes only open the port).
    link.attached.lock().expect("attached").clear();
    let drain = down(sim_down::Msg::Drain(link.draining.load(Ordering::Relaxed)));
    writer.write_u32(drain.len() as u32).await?;
    writer.write_all(&drain).await?;
    if let Ok(json) = state.war.snapshot(state).await {
        let war = serde_json::from_str::<serde_json::Value>(&json)
            .ok()
            .and_then(|v| v.get("war").cloned())
            .map(|w| w.to_string())
            .unwrap_or_default();
        let msg = down(sim_down::Msg::War(Doc { json: format!(r#"{{"war":{war}}}"#).into_bytes() }));
        writer.write_u32(msg.len() as u32).await?;
        writer.write_all(&msg).await?;
    }
    loop {
        tokio::select! {
            out = rx.recv() => {
                let Some(msg) = out else { return Ok(()) };
                writer.write_u32(msg.len() as u32).await?;
                writer.write_all(&msg).await?;
            }
            len = reader.read_u32() => {
                let n = len? as usize;
                if n > MAX_FRAME {
                    anyhow::bail!("sim frame too large");
                }
                let mut buf = vec![0u8; n];
                reader.read_exact(&mut buf).await?;
                if let Ok(up) = SimUp::decode(buf.as_slice()) {
                    state.coop.on_up(state, idx, up).await;
                }
            }
        }
    }
}

/// Keep a connection to every sim worker (reconnecting), feeding its messages to the router.
pub fn spawn(state: State) {
    if let Some(mut rx) = state.coop.entries_rx.lock().expect("entries").take() {
        let state = state.clone();
        tokio::spawn(async move {
            while let Some(e) = rx.recv().await {
                let Ok(account) = Uuid::parse_str(&e.account) else { continue };
                match crate::sync::apply_trusted(&state, account, e.device, e.entries).await {
                    Ok(r) if r.results.iter().any(|x| !x.ok) => {
                        tracing::warn!(account = %account, results = ?r.results, "co-op entries refused")
                    }
                    Ok(_) => {}
                    Err(err) => tracing::error!(account = %account, error = %err.message, "co-op entries failed"),
                }
            }
        });
    }
    for (idx, link) in state.coop.links.iter().cloned().enumerate() {
        let state = state.clone();
        tokio::spawn(async move {
            let Some(mut rx) = link.rx.lock().await.take() else { return };
            loop {
                if let Err(e) = exchange(&state, idx, &link, &mut rx).await
                    && link.up.swap(false, Ordering::Relaxed)
                {
                    tracing::warn!(worker = %link.addr, error = %e, "sim worker connection lost");
                    state.coop.lost(&state, idx);
                }
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        });
    }
}
