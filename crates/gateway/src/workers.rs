//! Client of the internal TypeScript workers (apps/worker): length-prefixed protobuf frames over TCP.
//! A small pool of connections per worker; each connection carries one request at a time (a Node worker
//! is single-threaded anyway), requests rotate over the workers, broken connections are re-opened once.

use std::{
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

use anyhow::{Context, Result, anyhow, bail};
use prost::Message;
use riftwarden_proto::v1::{WorkerRequest, WorkerResponse, worker_request, worker_response};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    sync::Mutex,
};

const MAX_FRAME: usize = 16 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);

struct Slot {
    addr: String,
    conn: Mutex<Option<TcpStream>>,
}

pub struct Workers {
    slots: Vec<Slot>,
    next: AtomicUsize,
    ids: AtomicUsize,
}

impl Workers {
    /// `addrs`: worker addresses; `per_worker`: connections kept to each.
    pub fn new(addrs: &[String], per_worker: usize) -> Self {
        let slots =
            addrs.iter().flat_map(|a| (0..per_worker.max(1)).map(move |_| Slot { addr: a.clone(), conn: Mutex::new(None) })).collect();
        Self { slots, next: AtomicUsize::new(0), ids: AtomicUsize::new(1) }
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    async fn exchange(stream: &mut TcpStream, frame: &[u8]) -> Result<Vec<u8>> {
        stream.write_u32(frame.len() as u32).await?;
        stream.write_all(frame).await?;
        let n = stream.read_u32().await? as usize;
        if n > MAX_FRAME {
            bail!("worker frame too large ({n} bytes)");
        }
        let mut buf = vec![0u8; n];
        stream.read_exact(&mut buf).await?;
        Ok(buf)
    }

    /// Send one call and wait for its answer.
    pub async fn call(&self, call: worker_request::Call) -> Result<worker_response::Result> {
        if self.slots.is_empty() {
            bail!("no workers configured (RIFT_RULES_WORKERS)");
        }
        let id = self.ids.fetch_add(1, Ordering::Relaxed) as u32;
        let frame = WorkerRequest { id, call: Some(call) }.encode_to_vec();
        let start = self.next.fetch_add(1, Ordering::Relaxed);
        let mut last = anyhow!("no worker answered");
        // Try each slot once, starting from the round-robin position.
        for k in 0..self.slots.len() {
            let slot = &self.slots[(start + k) % self.slots.len()];
            let mut guard = slot.conn.lock().await;
            for attempt in 0..2 {
                if guard.is_none() {
                    match TcpStream::connect(&slot.addr).await {
                        Ok(s) => {
                            s.set_nodelay(true).ok();
                            *guard = Some(s);
                        }
                        Err(e) => {
                            last = anyhow!("worker {}: {e}", slot.addr);
                            break;
                        }
                    }
                }
                let stream = guard.as_mut().expect("connected");
                match tokio::time::timeout(TIMEOUT, Self::exchange(stream, &frame)).await {
                    Ok(Ok(bytes)) => {
                        let res = WorkerResponse::decode(bytes.as_slice()).context("worker answer")?;
                        if res.id != id {
                            *guard = None;
                            last = anyhow!("worker answered out of order");
                            continue;
                        }
                        if let Some(e) = res.error {
                            return Err(WorkerError { code: e.code, message: e.msg }.into());
                        }
                        return res.result.ok_or_else(|| anyhow!("empty worker answer"));
                    }
                    Ok(Err(e)) => last = anyhow!("worker {} (attempt {attempt}): {e}", slot.addr),
                    Err(_) => last = anyhow!("worker {} timed out", slot.addr),
                }
                *guard = None;
            }
        }
        Err(last)
    }
}

/// A call the worker refused (as opposed to a transport failure).
#[derive(Debug, thiserror::Error)]
#[error("{code}: {message}")]
pub struct WorkerError {
    pub code: String,
    pub message: String,
}
