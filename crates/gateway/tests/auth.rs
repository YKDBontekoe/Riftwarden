//! Account endpoints that do not need a real authenticator (the full passkey ceremonies run in the
//! browser suite with Playwright's virtual authenticator). Skipped without RIFT_TEST_DATABASE_URL / RIFT_TEST_REDIS_URL.

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use riftwarden_gateway::{Config, connect, limits, router};
use serde_json::{Value, json};
use tower::ServiceExt;

fn config() -> Option<Config> {
    Some(Config::for_tests(std::env::var("RIFT_TEST_DATABASE_URL").ok()?, std::env::var("RIFT_TEST_REDIS_URL").ok()?))
}

async fn call(
    app: &axum::Router,
    method: &str,
    uri: &str,
    body: Option<Value>,
    cookie: Option<&str>,
) -> (StatusCode, Value, Option<String>) {
    let mut req = Request::builder().method(method).uri(uri);
    if body.is_some() {
        req = req.header(header::CONTENT_TYPE, "application/json");
    }
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c);
    }
    let req = req.body(body.map(|b| Body::from(b.to_string())).unwrap_or_default()).unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let set_cookie = res.headers().get(header::SET_COOKIE).map(|v| v.to_str().unwrap().to_owned());
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null), set_cookie)
}

fn unique(prefix: &str) -> String {
    format!("{prefix}{}", &uuid::Uuid::new_v4().simple().to_string()[..8])
}

#[tokio::test]
async fn names_registration_options_and_guards() {
    let Some(cfg) = config() else { return eprintln!("skipped") };
    let state = connect(cfg).await.unwrap();
    let app = router(state.clone());

    // Name checks: invalid, free.
    let (s, v, _) = call(&app, "GET", "/auth/name?name=ab", None, None).await;
    assert_eq!(s, 200);
    assert_eq!(v["available"], false);
    let free = unique("Warden");
    let (_, v, _) = call(&app, "GET", &format!("/auth/name?name={free}"), None, None).await;
    assert_eq!(v["available"], true);

    // Registration start: WebAuthn creation options for this RP, resident key preferred, user verification required.
    let (s, v, _) = call(&app, "POST", "/auth/register/start", Some(json!({ "name": free })), None).await;
    assert_eq!(s, 200, "{v}");
    let pk = &v["options"]["publicKey"];
    assert_eq!(pk["rp"]["id"], "localhost");
    assert_eq!(pk["user"]["name"], free.as_str());
    assert_eq!(pk["authenticatorSelection"]["residentKey"], "preferred");
    assert_eq!(pk["authenticatorSelection"]["userVerification"], "required");
    assert!(pk["challenge"].as_str().is_some_and(|c| c.len() >= 32));
    let ceremony = v["ceremony"].as_str().unwrap().to_owned();

    // A forged credential is rejected and the ceremony is single use.
    let forged = json!({ "ceremony": ceremony, "credential": {
        "id": "AAAA", "rawId": "AAAA", "type": "public-key",
        "response": { "attestationObject": "AAAA", "clientDataJSON": "AAAA" }, "extensions": {} } });
    let (s, v, _) = call(&app, "POST", "/auth/register/finish", Some(forged.clone()), None).await;
    assert_eq!(s, 400, "{v}");
    let (s, v, _) = call(&app, "POST", "/auth/register/finish", Some(forged), None).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::BAD_REQUEST, Some("ceremony_expired")));

    // Invalid names are refused before any ceremony.
    let (s, v, _) = call(&app, "POST", "/auth/register/start", Some(json!({ "name": "<x>" })), None).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::BAD_REQUEST, Some("invalid_name")));

    // Sign-in for an unknown name, recovery with a wrong code.
    let (s, v, _) = call(&app, "POST", "/auth/login/start", Some(json!({ "name": unique("Nobody") })), None).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::BAD_REQUEST, Some("unknown_account")));
    let (s, v, _) =
        call(&app, "POST", "/auth/recover/start", Some(json!({ "name": unique("Nobody"), "code": "0000-0000-0000-0000" })), None).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::BAD_REQUEST, Some("recovery_rejected")));
}

#[tokio::test]
async fn sessions_taken_names_and_recovery_codes() {
    let Some(cfg) = config() else { return eprintln!("skipped") };
    let state = connect(cfg).await.unwrap();
    let app = router(state.clone());

    // Seed an account directly (the passkey document is opaque to these endpoints).
    let id = uuid::Uuid::new_v4();
    let name = unique("Seeded");
    let code = riftwarden_gateway::auth::recovery::generate();
    let hash = riftwarden_gateway::auth::recovery::hash(&code).unwrap();
    riftwarden_db::accounts::create_account(&state.db, id, &name, id.as_bytes(), &json!({}), &hash).await.unwrap();

    // Names are unique case-insensitively.
    let (s, v, _) = call(&app, "POST", "/auth/register/start", Some(json!({ "name": name.to_uppercase() })), None).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::CONFLICT, Some("name_taken")));

    // No cookie: not signed in.
    let (s, _, _) = call(&app, "GET", "/auth/me", None, None).await;
    assert_eq!(s, 401);

    // A session cookie signs in, logout ends it.
    let cookie = riftwarden_gateway::auth::session::start(&state, id, "test").await.unwrap();
    let cookie = cookie.to_str().unwrap().split(';').next().unwrap().to_owned();
    assert!(cookie.starts_with("rw_session="));
    let (s, v, _) = call(&app, "GET", "/auth/me", None, Some(&cookie)).await;
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["account"]["name"], name.as_str());
    assert_eq!(v["passkeys"].as_array().map(Vec::len), Some(1));

    // The last passkey cannot be removed.
    let pid = v["passkeys"][0]["id"].as_str().unwrap().to_owned();
    let (s, v, _) = call(&app, "DELETE", &format!("/auth/passkeys/{pid}"), None, Some(&cookie)).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::BAD_REQUEST, Some("last_passkey")));

    // Rename: free name works, then the cooldown applies.
    let renamed = unique("Renamed");
    let (s, v, _) = call(&app, "POST", "/auth/rename", Some(json!({ "name": renamed })), Some(&cookie)).await;
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["name"], renamed.as_str());
    let (s, v, _) = call(&app, "POST", "/auth/rename", Some(json!({ "name": unique("Again") })), Some(&cookie)).await;
    assert_eq!((s, v["error"].as_str()), (StatusCode::BAD_REQUEST, Some("rename_cooldown")));

    // The right recovery code opens a registration ceremony for the existing account.
    let (s, v, _) =
        call(&app, "POST", "/auth/recover/start", Some(json!({ "name": renamed.to_lowercase(), "code": code.to_lowercase() })), None).await;
    assert_eq!(s, 200, "{v}");
    assert_eq!(v["options"]["publicKey"]["user"]["name"], renamed.as_str());
    assert_eq!(v["options"]["publicKey"]["excludeCredentials"].as_array().map(Vec::len), Some(1));

    // A regenerated code replaces the old one.
    let (s, v, _) = call(&app, "POST", "/auth/recovery-code", None, Some(&cookie)).await;
    assert_eq!(s, 200);
    let fresh = v["recoveryCode"].as_str().unwrap().to_owned();
    let stored = riftwarden_db::accounts::recovery_hash(&state.db, id).await.unwrap().unwrap();
    assert!(riftwarden_gateway::auth::recovery::verify(&fresh, &stored));
    assert!(!riftwarden_gateway::auth::recovery::verify(&code, &stored));

    let (s, _, cleared) = call(&app, "POST", "/auth/logout", None, Some(&cookie)).await;
    assert_eq!(s, 204);
    assert!(cleared.is_some_and(|c| c.contains("Max-Age=0")));
    let (s, _, _) = call(&app, "GET", "/auth/me", None, Some(&cookie)).await;
    assert_eq!(s, 401, "the session ended (also in the Redis cache)");
}

#[tokio::test]
async fn rate_limits_count_per_key() {
    let Some(mut cfg) = config() else { return eprintln!("skipped") };
    cfg.test_mode = false;
    let state = connect(cfg).await.unwrap();
    let key = unique("ip-");
    assert!(limits::hit(&state, "t", &key, 2, 60).await.is_ok());
    assert!(limits::hit(&state, "t", &key, 2, 60).await.is_ok());
    assert_eq!(limits::hit(&state, "t", &key, 2, 60).await.unwrap_err().status, StatusCode::TOO_MANY_REQUESTS);
    assert!(limits::hit(&state, "t", &unique("ip-"), 2, 60).await.is_ok(), "other keys are unaffected");
}

#[tokio::test]
async fn desktop_approval_requires_a_matching_verifier_and_is_single_use() {
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    use sha2::{Digest, Sha256};
    let Some(cfg) = config() else { return eprintln!("skipped") };
    let state = connect(cfg).await.unwrap();
    let app = router(state.clone());
    let id = uuid::Uuid::new_v4();
    let name = unique("Desktop");
    riftwarden_db::accounts::create_account(&state.db, id, &name, id.as_bytes(), &json!({}), "test").await.unwrap();
    let cookie = riftwarden_gateway::auth::session::start(&state, id, "test").await.unwrap();
    let cookie = cookie.to_str().unwrap().split(';').next().unwrap().to_owned();
    let verifier = riftwarden_gateway::auth::session::new_token();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let (status, body, _) = call(&app, "POST", "/auth/desktop/start", Some(json!({ "challenge": challenge })), None).await;
    assert_eq!(status, 200);
    let request = body["id"].as_str().unwrap();
    let (status, _, _) = call(&app, "POST", "/auth/desktop/poll", Some(json!({ "id": request, "verifier": verifier })), None).await;
    assert_eq!(status, 202);
    let (status, _, _) = call(&app, "POST", "/auth/desktop/approve", Some(json!({ "id": request })), None).await;
    assert_eq!(status, 401);
    let (status, _, _) = call(&app, "POST", "/auth/desktop/approve", Some(json!({ "id": request })), Some(&cookie)).await;
    assert_eq!(status, 204);
    let wrong = riftwarden_gateway::auth::session::new_token();
    let (status, _, _) = call(&app, "POST", "/auth/desktop/poll", Some(json!({ "id": request, "verifier": wrong })), None).await;
    assert_eq!(status, 401);
    let (status, body, _) = call(&app, "POST", "/auth/desktop/poll", Some(json!({ "id": request, "verifier": verifier })), None).await;
    assert_eq!(status, 200);
    let desktop_cookie = body["cookie"].as_str().unwrap().split(';').next().unwrap();
    let (status, body, _) = call(&app, "GET", "/auth/me", None, Some(desktop_cookie)).await;
    assert_eq!(status, 200);
    assert_eq!(body["account"]["name"], name);
    let (status, _, _) = call(&app, "POST", "/auth/desktop/poll", Some(json!({ "id": request, "verifier": verifier })), None).await;
    assert_eq!(status, 400);
}
