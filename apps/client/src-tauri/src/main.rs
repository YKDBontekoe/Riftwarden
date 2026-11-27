#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use axum::{
    body::{to_bytes, Body},
    extract::{ws::Message, Path, State, WebSocketUpgrade},
    http::{header, Request, Response, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};
use tauri::{Manager, State as AppState};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message as RemoteMessage};
mod cors;
mod mouse_capture;

const API: &str = "https://riftwarden-api.ykdbonte.dev";
const SITE: &str = "https://riftwarden.ykdbonte.dev";

struct Desktop {
    secret: String,
    base: String,
    cookie: Mutex<Option<String>>,
    request: Mutex<Option<(String, String)>>,
    client: reqwest::Client,
}

fn random() -> String {
    let mut data = [0u8; 32];
    rand::rng().fill_bytes(&mut data);
    URL_SAFE_NO_PAD.encode(data)
}

fn keyring() -> Result<keyring::Entry, String> {
    keyring::Entry::new("dev.ykdbonte.riftwarden", "session").map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct Settings {
    base: String,
    native_mouse: bool,
}
#[tauri::command]
fn desktop_settings(state: AppState<'_, Arc<Desktop>>) -> Settings {
    Settings { base: state.base.clone(), native_mouse: cfg!(target_os = "macos") }
}

#[derive(Deserialize)]
struct Started {
    id: String,
}
#[derive(Deserialize)]
struct Completed {
    cookie: String,
}

#[tauri::command]
async fn desktop_sign_in(state: AppState<'_, Arc<Desktop>>) -> Result<String, String> {
    let verifier = random();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let response = state
        .client
        .post(format!("{API}/auth/desktop/start"))
        .json(&serde_json::json!({ "challenge": challenge }))
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json::<Started>()
        .await
        .map_err(|e| e.to_string())?;
    *state.request.lock().map_err(|e| e.to_string())? = Some((response.id.clone(), verifier));
    Ok(format!("{SITE}/?desktop={}#/account", response.id))
}

#[tauri::command]
async fn desktop_poll_sign_in(state: AppState<'_, Arc<Desktop>>) -> Result<bool, String> {
    let request = state.request.lock().map_err(|e| e.to_string())?.clone().ok_or("No sign-in in progress")?;
    let response = state
        .client
        .post(format!("{API}/auth/desktop/poll"))
        .json(&serde_json::json!({ "id": request.0, "verifier": request.1 }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if response.status() == reqwest::StatusCode::ACCEPTED {
        return Ok(false);
    }
    let result = response.error_for_status().map_err(|e| e.to_string())?.json::<Completed>().await.map_err(|e| e.to_string())?;
    let cookie = result.cookie.split(';').next().ok_or("Invalid session")?.to_owned();
    if !cookie.starts_with("rw_session=") {
        return Err("Invalid session".into());
    }
    keyring()?.set_password(&cookie).map_err(|e| e.to_string())?;
    *state.cookie.lock().map_err(|e| e.to_string())? = Some(cookie);
    *state.request.lock().map_err(|e| e.to_string())? = None;
    Ok(true)
}

#[tauri::command]
fn desktop_forget_session(state: AppState<'_, Arc<Desktop>>) -> Result<(), String> {
    *state.cookie.lock().map_err(|e| e.to_string())? = None;
    let _ = keyring()?.delete_credential();
    Ok(())
}

async fn proxy(State(state): State<Arc<Desktop>>, Path((secret, path)): Path<(String, String)>, request: Request<Body>) -> Response<Body> {
    if secret != state.secret {
        return StatusCode::NOT_FOUND.into_response();
    }
    let allowed = path == "session" || ["auth/", "war", "boards", "rooms"].iter().any(|prefix| path.starts_with(prefix));
    if !allowed {
        return StatusCode::NOT_FOUND.into_response();
    }
    let query = request.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
    let method = request.method().clone();
    let content_type = request.headers().get(header::CONTENT_TYPE).cloned();
    let body = match to_bytes(request.into_body(), 8 * 1024 * 1024).await {
        Ok(b) => b,
        Err(_) => return StatusCode::PAYLOAD_TOO_LARGE.into_response(),
    };
    let mut outgoing = state.client.request(method, format!("{API}/{path}{query}"));
    if let Some(content_type) = content_type {
        outgoing = outgoing.header(header::CONTENT_TYPE, content_type);
    }
    if let Some(cookie) = state.cookie.lock().ok().and_then(|c| c.clone()) {
        outgoing = outgoing.header(header::COOKIE, cookie);
    }
    let result = match outgoing.body(body).send().await {
        Ok(r) => r,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };
    let status = result.status();
    let content_type = result.headers().get(header::CONTENT_TYPE).cloned();
    let bytes = match result.bytes().await {
        Ok(b) => b,
        Err(_) => return StatusCode::BAD_GATEWAY.into_response(),
    };
    let mut response = Response::builder().status(status);
    if let Some(content_type) = content_type {
        response = response.header(header::CONTENT_TYPE, content_type);
    }
    response.body(Body::from(bytes)).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn socket(State(state): State<Arc<Desktop>>, Path(secret): Path<String>, ws: WebSocketUpgrade) -> Response<Body> {
    if secret != state.secret {
        return StatusCode::NOT_FOUND.into_response();
    }
    let cookie = match state.cookie.lock().ok().and_then(|c| c.clone()) {
        Some(c) => c,
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };
    ws.on_upgrade(move |mut local| async move {
        let Ok(mut request) = "wss://riftwarden-api.ykdbonte.dev/session".into_client_request() else { return };
        let Ok(value) = cookie.parse() else { return };
        request.headers_mut().insert(header::COOKIE, value);
        request.headers_mut().insert(header::ORIGIN, header::HeaderValue::from_static(SITE));
        let Ok((mut remote, _)) = tokio_tungstenite::connect_async(request).await else { return };
        loop {
            tokio::select! {
                incoming = local.recv() => match incoming {
                    Some(Ok(Message::Binary(data))) => if remote.send(RemoteMessage::Binary(data)).await.is_err() { break },
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                },
                incoming = remote.next() => match incoming {
                    Some(Ok(RemoteMessage::Binary(data))) => if local.send(Message::Binary(data)).await.is_err() { break },
                    Some(Ok(RemoteMessage::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    })
    .into_response()
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
            listener.set_nonblocking(true)?;
            let port = listener.local_addr()?.port();
            let secret = random();
            let state = Arc::new(Desktop {
                base: format!("http://127.0.0.1:{port}/{secret}"),
                secret,
                cookie: Mutex::new(keyring().ok().and_then(|entry| entry.get_password().ok())),
                request: Mutex::new(None),
                client: reqwest::Client::builder()
                    .connect_timeout(std::time::Duration::from_secs(5))
                    .timeout(std::time::Duration::from_secs(20))
                    .build()?,
            });
            app.manage(state.clone());
            let router = Router::new()
                .route("/{secret}/session", any(socket))
                .route("/{secret}/{*path}", any(proxy))
                .layer(cors::local_proxy())
                .with_state(state);
            tauri::async_runtime::spawn(async move {
                if let Ok(listener) = tokio::net::TcpListener::from_std(listener) {
                    let _ = axum::serve(listener, router).await;
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_settings,
            desktop_sign_in,
            desktop_poll_sign_in,
            desktop_forget_session,
            mouse_capture::desktop_mouse_start,
            mouse_capture::desktop_mouse_stop,
            mouse_capture::desktop_mouse_take
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Riftwarden");
}
