//! The session socket (`/session`, binary protobuf frames, proto/riftwarden/v1/session.proto): one per
//! signed-in client. Carries request/response calls (sync) and pushes profile-change notices from the
//! account's other devices. Authenticated by the session cookie at the upgrade.

use axum::{
    Router,
    extract::{
        State as Extract, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use prost::Message as _;
use riftwarden_proto::v1::{
    Error as ProtoError, ProfileChanged, SessionClientFrame, SessionResponse, SessionServerFrame, session_client_frame, session_response,
    session_server_frame,
};

use crate::{State, auth::session::Authed, limits::ClientIp};

const MAX_FRAME: usize = 8 * 1024 * 1024;

pub fn routes() -> Router<State> {
    Router::new().route("/session", get(upgrade))
}

async fn upgrade(Extract(state): Extract<State>, headers: HeaderMap, auth: Authed, ip: ClientIp, ws: WebSocketUpgrade) -> Response {
    // Browsers always send Origin on WebSocket upgrades: refuse pages of other sites (cross-site socket
    // hijacking with the session cookie). Clients without one (bots, tools) are not browsers.
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok())
        && !state.config.client_origins.iter().any(|o| o.origin().ascii_serialization() == origin)
    {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    ws.max_message_size(MAX_FRAME).on_upgrade(move |socket| run(state, auth, ip, socket))
}

fn frame(msg: session_server_frame::Msg) -> Message {
    Message::Binary(SessionServerFrame { msg: Some(msg) }.encode_to_vec().into())
}

async fn run(state: State, auth: Authed, ip: ClientIp, mut socket: WebSocket) {
    let conn = state.hub.connection_id();
    let mut changes = state.hub.subscribe(auth.account);
    let name = riftwarden_db::accounts::account_by_id(&state.db, auth.account)
        .await
        .ok()
        .flatten()
        .map(|a| a.name)
        .unwrap_or_else(|| "Warden".into());
    // Co-op frames for this connection (from the sim workers, through the router).
    let (coop_tx, mut coop_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    tracing::info!(account = %auth.account, conn, ip = %ip.0, "session opened");
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(msg)) = incoming else { break };
                let bytes = match msg {
                    Message::Binary(b) => b,
                    Message::Close(_) => break,
                    _ => continue,
                };
                let Ok(req) = SessionClientFrame::decode(bytes.as_ref()) else {
                    let _ = socket.send(frame(session_server_frame::Msg::Error(ProtoError { code: "malformed".into(), msg: "Unreadable frame".into() }))).await;
                    continue;
                };
                let id = req.id;
                let response = match req.call {
                    // Co-op traffic (30 Hz input) is rate limited by the sim worker, not here.
                    Some(session_client_frame::Call::Coop(frame)) => {
                        state.coop.from_client(&state, auth.account, &name, conn, &coop_tx, frame.to_vec()).await;
                        continue;
                    }
                    Some(session_client_frame::Call::Sync(sync)) => {
                        if crate::limits::hit(&state, "session", &auth.account.to_string(), 120, 60).await.is_err() {
                            SessionResponse { id, error: Some(ProtoError { code: "rate_limited".into(), msg: "Too many requests".into() }), result: None }
                        } else {
                            match crate::sync::sync(&state, auth.account, conn, sync).await {
                                Ok(r) => SessionResponse { id, error: None, result: Some(session_response::Result::Sync(r)) },
                                Err(e) => SessionResponse { id, error: Some(ProtoError { code: e.code.into(), msg: e.message }), result: None },
                            }
                        }
                    }
                    None => SessionResponse { id, error: Some(ProtoError { code: "unknown_call".into(), msg: "Unknown call".into() }), result: None },
                };
                if socket.send(frame(session_server_frame::Msg::Response(response))).await.is_err() {
                    break;
                }
            }
            out = coop_rx.recv() => {
                let Some(bytes) = out else { break };
                if socket.send(frame(session_server_frame::Msg::Coop(bytes))).await.is_err() {
                    break;
                }
            }
            change = changes.recv() => match change {
                Ok((from, rev)) if from != conn => {
                    if socket.send(frame(session_server_frame::Msg::Changed(ProfileChanged { rev }))).await.is_err() {
                        break;
                    }
                }
                Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                Err(_) => break,
            },
        }
    }
    state.coop.detach(auth.account, conn);
    tracing::info!(account = %auth.account, conn, "session closed");
}
