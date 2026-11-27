//! Passkey accounts (architecture v2 section 6): sign-up, sign-in (name first, then the passkey), recovery
//! codes, extra passkeys, rename, sign-out. WebAuthn ceremonies keep their state in Redis for five minutes
//! and are single use.

pub mod desktop;
pub mod names;
pub mod recovery;
pub mod session;

use axum::{
    Json, Router,
    extract::{Path, Query, State as Extract},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use redis::AsyncCommands;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use uuid::Uuid;
use webauthn_rs::prelude::{Passkey, PasskeyAuthentication, PasskeyRegistration, PublicKeyCredential, RegisterPublicKeyCredential};
use webauthn_rs::{Webauthn, WebauthnBuilder};

use crate::{
    Config, State,
    error::{ApiError, ApiResult},
    limits::{ClientIp, hit},
};
use session::Authed;

const CEREMONY_S: u64 = 300;
const RENAME_COOLDOWN_DAYS: i64 = 7;

pub fn webauthn(config: &Config) -> anyhow::Result<Webauthn> {
    let first = config.client_origins.first().ok_or_else(|| anyhow::anyhow!("RIFT_CLIENT_ORIGINS is empty"))?;
    let mut b = WebauthnBuilder::new(&config.rp_id, first)?.rp_name("Riftwarden").allow_any_port(config.test_mode);
    for o in config.client_origins.iter().skip(1) {
        b = b.append_allowed_origin(o);
    }
    Ok(b.build()?)
}

pub fn routes() -> Router<State> {
    Router::new()
        .route("/auth/desktop/start", post(desktop::begin))
        .route("/auth/desktop/approve", post(desktop::approve))
        .route("/auth/desktop/poll", post(desktop::poll))
        .route("/auth/name", get(name_check))
        .route("/auth/register/start", post(register_start))
        .route("/auth/register/finish", post(register_finish))
        .route("/auth/login/start", post(login_start))
        .route("/auth/login/finish", post(login_finish))
        .route("/auth/recover/start", post(recover_start))
        .route("/auth/recover/finish", post(recover_finish))
        .route("/auth/me", get(me))
        .route("/auth/logout", post(logout))
        .route("/auth/passkeys/start", post(add_start))
        .route("/auth/passkeys/finish", post(add_finish))
        .route("/auth/passkeys/{id}", delete(remove_passkey))
        .route("/auth/recovery-code", post(new_recovery_code))
        .route("/auth/rename", post(rename))
        .route("/auth/test-login", post(test_login))
}

#[derive(Deserialize)]
struct TestLogin {
    name: String,
}

/// Test servers only (RIFT_TEST=1): sign in as `name`, creating the account with a dummy passkey. Bots and
/// protocol suites use it; it does not exist on production servers.
async fn test_login(Extract(state): Extract<State>, headers: HeaderMap, Json(req): Json<TestLogin>) -> ApiResult<Response> {
    if !state.config.test_mode {
        return Err(ApiError::new(StatusCode::NOT_FOUND, "not_found", "Not found"));
    }
    let name = names::validate(&req.name).map_err(|m| ApiError::bad("bad_name", m))?;
    let account = match riftwarden_db::accounts::account_by_name(&state.db, &name).await? {
        Some(a) => a,
        None => {
            let id = Uuid::new_v4();
            riftwarden_db::accounts::create_account(&state.db, id, &name, id.as_bytes(), &serde_json::json!({}), "test").await?
        }
    };
    let cookie = session::start(&state, account.id, &session::user_agent(&headers)).await?;
    Ok(with_cookie(cookie, SignedIn { account: (&account).into(), recovery_code: None }))
}

// ------------------------------------------------------------------ ceremony state

#[derive(Serialize, Deserialize)]
enum Ceremony {
    /// A new account: the id and name are reserved for the ceremony only (the account exists after finish).
    Register {
        account: Uuid,
        name: String,
        state: PasskeyRegistration,
    },
    Login {
        account: Uuid,
        state: PasskeyAuthentication,
    },
    /// Recovery code accepted: registering a replacement passkey for the account.
    Recover {
        account: Uuid,
        state: PasskeyRegistration,
    },
    /// A signed-in account adds another passkey.
    Add {
        account: Uuid,
        label: String,
        state: PasskeyRegistration,
    },
}

async fn put_ceremony(state: &State, c: &Ceremony) -> ApiResult<String> {
    let id = session::new_token();
    let mut r = state.redis.clone();
    let _: () = r.set_ex(format!("rw:cer:{id}"), serde_json::to_string(c).map_err(ApiError::internal)?, CEREMONY_S).await?;
    Ok(id)
}

/// Single use: the state is deleted as it is read.
async fn take_ceremony(state: &State, id: &str) -> ApiResult<Ceremony> {
    let mut r = state.redis.clone();
    let raw: Option<String> = redis::cmd("GETDEL").arg(format!("rw:cer:{id}")).query_async(&mut r).await?;
    let raw = raw.ok_or_else(|| ApiError::bad("ceremony_expired", "That request expired, try again"))?;
    serde_json::from_str(&raw).map_err(ApiError::internal)
}

/// Ask authenticators for a discoverable (synced) passkey where they can make one.
fn prefer_resident(mut options: serde_json::Value) -> serde_json::Value {
    if let Some(sel) = options.pointer_mut("/publicKey/authenticatorSelection").and_then(|v| v.as_object_mut()) {
        sel.insert("residentKey".into(), "preferred".into());
    }
    options
}

fn to_json<T: Serialize>(v: &T) -> ApiResult<serde_json::Value> {
    serde_json::to_value(v).map_err(ApiError::internal)
}

fn from_json<T: DeserializeOwned>(v: &serde_json::Value) -> ApiResult<T> {
    serde_json::from_value(v.clone()).map_err(ApiError::internal)
}

fn bad_credential(e: impl std::fmt::Display) -> ApiError {
    tracing::info!(error = %e, "passkey ceremony rejected");
    ApiError::bad("passkey_rejected", "The passkey could not be verified")
}

// ------------------------------------------------------------------ responses

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    id: Uuid,
    name: String,
    admin: bool,
    created_at: DateTime<Utc>,
    can_rename_at: Option<DateTime<Utc>>,
}

impl From<&riftwarden_db::accounts::Account> for AccountView {
    fn from(a: &riftwarden_db::accounts::Account) -> Self {
        Self {
            id: a.id,
            name: a.name.clone(),
            admin: a.admin,
            created_at: a.created_at,
            can_rename_at: a.renamed_at.map(|t| t + Duration::days(RENAME_COOLDOWN_DAYS)).filter(|t| *t > Utc::now()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedIn {
    account: AccountView,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_code: Option<String>,
}

fn with_cookie(cookie: header::HeaderValue, body: impl Serialize) -> Response {
    ([(header::SET_COOKIE, cookie)], Json(body)).into_response()
}

#[derive(Serialize)]
struct Started {
    ceremony: String,
    options: serde_json::Value,
}

async fn hashed(code: &str) -> ApiResult<String> {
    let code = code.to_owned();
    tokio::task::spawn_blocking(move || recovery::hash(&code)).await.map_err(ApiError::internal)?.map_err(ApiError::internal)
}

async fn account(state: &State, id: Uuid) -> ApiResult<riftwarden_db::accounts::Account> {
    riftwarden_db::accounts::account_by_id(&state.db, id).await?.ok_or_else(ApiError::unauthorized)
}

// ------------------------------------------------------------------ names

#[derive(Deserialize)]
struct NameQuery {
    name: String,
}

#[derive(Serialize)]
struct NameAnswer {
    available: bool,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

async fn name_check(Extract(state): Extract<State>, ip: ClientIp, Query(q): Query<NameQuery>) -> ApiResult<Json<NameAnswer>> {
    hit(&state, "name", &ip.0, 60, 60).await?;
    match names::validate(&q.name) {
        Err(reason) => Ok(Json(NameAnswer { available: false, name: q.name, reason: Some(reason) })),
        Ok(name) => {
            let taken = riftwarden_db::accounts::account_by_name(&state.db, &name).await?.is_some();
            Ok(Json(NameAnswer { available: !taken, name, reason: taken.then_some("That name is taken") }))
        }
    }
}

// ------------------------------------------------------------------ sign-up

#[derive(Deserialize)]
struct NameBody {
    name: String,
}

async fn register_start(Extract(state): Extract<State>, ip: ClientIp, Json(b): Json<NameBody>) -> ApiResult<Json<Started>> {
    hit(&state, "register", &ip.0, 10, 60).await?;
    let name = names::validate(&b.name).map_err(|r| ApiError::bad("invalid_name", r))?;
    if riftwarden_db::accounts::account_by_name(&state.db, &name).await?.is_some() {
        return Err(ApiError::conflict("name_taken", "That name is taken"));
    }
    let account = Uuid::new_v4();
    let (options, reg) = state.webauthn.start_passkey_registration(account, &name, &name, None).map_err(ApiError::internal)?;
    let ceremony = put_ceremony(&state, &Ceremony::Register { account, name, state: reg }).await?;
    Ok(Json(Started { ceremony, options: prefer_resident(to_json(&options)?) }))
}

#[derive(Deserialize)]
struct FinishRegistration {
    ceremony: String,
    credential: RegisterPublicKeyCredential,
}

async fn register_finish(Extract(state): Extract<State>, headers: HeaderMap, Json(b): Json<FinishRegistration>) -> ApiResult<Response> {
    let Ceremony::Register { account, name, state: reg } = take_ceremony(&state, &b.ceremony).await? else {
        return Err(ApiError::bad("ceremony_mismatch", "Wrong request"));
    };
    let passkey = state.webauthn.finish_passkey_registration(&b.credential, &reg).map_err(bad_credential)?;
    let code = recovery::generate();
    let created =
        riftwarden_db::accounts::create_account(&state.db, account, &name, passkey.cred_id(), &to_json(&passkey)?, &hashed(&code).await?)
            .await
            .map_err(|e| match e {
                riftwarden_db::DbError::Conflict => ApiError::conflict("name_taken", "That name was just taken"),
                other => other.into(),
            })?;
    tracing::info!(account = %created.id, "account created");
    let cookie = session::start(&state, created.id, &session::user_agent(&headers)).await?;
    Ok(with_cookie(cookie, SignedIn { account: (&created).into(), recovery_code: Some(code) }))
}

// ------------------------------------------------------------------ sign-in

/// Credential ids of the account (registration excludes them, so one authenticator is not enrolled twice).
async fn credential_ids(state: &State, account: Uuid) -> ApiResult<Vec<Vec<u8>>> {
    Ok(riftwarden_db::accounts::passkeys(&state.db, account).await?.into_iter().map(|p| p.credential_id).collect())
}

async fn passkeys_of(state: &State, account: Uuid) -> ApiResult<Vec<Passkey>> {
    riftwarden_db::accounts::passkeys(&state.db, account).await?.iter().map(|p| from_json(&p.passkey)).collect()
}

async fn login_start(Extract(state): Extract<State>, ip: ClientIp, Json(b): Json<NameBody>) -> ApiResult<Json<Started>> {
    hit(&state, "login", &ip.0, 20, 60).await?;
    let unknown = || ApiError::bad("unknown_account", "No warden with that name");
    let account = riftwarden_db::accounts::account_by_name(&state.db, &names::normalize(&b.name)).await?.ok_or_else(unknown)?;
    let keys = passkeys_of(&state, account.id).await?;
    if keys.is_empty() {
        return Err(unknown());
    }
    let (options, auth) = state.webauthn.start_passkey_authentication(&keys).map_err(ApiError::internal)?;
    let ceremony = put_ceremony(&state, &Ceremony::Login { account: account.id, state: auth }).await?;
    Ok(Json(Started { ceremony, options: to_json(&options)? }))
}

#[derive(Deserialize)]
struct FinishAuthentication {
    ceremony: String,
    credential: PublicKeyCredential,
}

async fn login_finish(Extract(state): Extract<State>, headers: HeaderMap, Json(b): Json<FinishAuthentication>) -> ApiResult<Response> {
    let Ceremony::Login { account: id, state: auth } = take_ceremony(&state, &b.ceremony).await? else {
        return Err(ApiError::bad("ceremony_mismatch", "Wrong request"));
    };
    let result = state.webauthn.finish_passkey_authentication(&b.credential, &auth).map_err(bad_credential)?;
    // Keep the signature counter current (clone detection) and record the use.
    let mut keys = passkeys_of(&state, id).await?;
    if let Some(k) = keys.iter_mut().find(|k| k.cred_id() == result.cred_id()) {
        let changed = k.update_credential(&result).unwrap_or(false);
        riftwarden_db::accounts::touch_passkey(&state.db, k.cred_id(), changed.then(|| to_json(k)).transpose()?.as_ref()).await?;
    }
    let account = account(&state, id).await?;
    let cookie = session::start(&state, id, &session::user_agent(&headers)).await?;
    Ok(with_cookie(cookie, SignedIn { account: (&account).into(), recovery_code: None }))
}

// ------------------------------------------------------------------ recovery

#[derive(Deserialize)]
struct RecoverBody {
    name: String,
    code: String,
}

async fn recover_start(Extract(state): Extract<State>, ip: ClientIp, Json(b): Json<RecoverBody>) -> ApiResult<Json<Started>> {
    hit(&state, "recover", &ip.0, 5, 600).await?;
    let wrong = || ApiError::bad("recovery_rejected", "Name or recovery code is wrong");
    let account = riftwarden_db::accounts::account_by_name(&state.db, &names::normalize(&b.name)).await?.ok_or_else(wrong)?;
    hit(&state, "recover-account", &account.id.to_string(), 5, 3600).await?;
    let stored = riftwarden_db::accounts::recovery_hash(&state.db, account.id).await?.ok_or_else(wrong)?;
    let code = b.code.clone();
    let ok = tokio::task::spawn_blocking(move || recovery::verify(&code, &stored)).await.map_err(ApiError::internal)?;
    if !ok {
        return Err(wrong());
    }
    let existing = credential_ids(&state, account.id).await?;
    let (options, reg) =
        state.webauthn.start_passkey_registration(account.id, &account.name, &account.name, Some(existing)).map_err(ApiError::internal)?;
    let ceremony = put_ceremony(&state, &Ceremony::Recover { account: account.id, state: reg }).await?;
    Ok(Json(Started { ceremony, options: prefer_resident(to_json(&options)?) }))
}

async fn recover_finish(Extract(state): Extract<State>, headers: HeaderMap, Json(b): Json<FinishRegistration>) -> ApiResult<Response> {
    let Ceremony::Recover { account: id, state: reg } = take_ceremony(&state, &b.ceremony).await? else {
        return Err(ApiError::bad("ceremony_mismatch", "Wrong request"));
    };
    let passkey = state.webauthn.finish_passkey_registration(&b.credential, &reg).map_err(bad_credential)?;
    riftwarden_db::accounts::add_passkey(&state.db, id, passkey.cred_id(), &to_json(&passkey)?, "recovered").await?;
    // The code is consumed: a new one replaces it, and every other session is signed out.
    let code = recovery::generate();
    riftwarden_db::accounts::set_recovery(&state.db, id, &hashed(&code).await?).await?;
    let (cookie, hash) = session::start_with_hash(&state, id, &session::user_agent(&headers)).await?;
    session::end_others(&state, id, &hash).await?;
    let account = account(&state, id).await?;
    tracing::info!(account = %id, "account recovered");
    Ok(with_cookie(cookie, SignedIn { account: (&account).into(), recovery_code: Some(code) }))
}

// ------------------------------------------------------------------ signed-in account

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PasskeyView {
    id: String,
    label: String,
    created_at: DateTime<Utc>,
    last_used_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct Me {
    account: AccountView,
    passkeys: Vec<PasskeyView>,
}

async fn me(Extract(state): Extract<State>, auth: Authed) -> ApiResult<Json<Me>> {
    let account = account(&state, auth.account).await?;
    let passkeys = riftwarden_db::accounts::passkeys(&state.db, auth.account)
        .await?
        .into_iter()
        .map(|p| PasskeyView {
            id: URL_SAFE_NO_PAD.encode(&p.credential_id),
            label: p.label,
            created_at: p.created_at,
            last_used_at: p.last_used_at,
        })
        .collect();
    Ok(Json(Me { account: (&account).into(), passkeys }))
}

async fn logout(Extract(state): Extract<State>, auth: Option<Authed>) -> ApiResult<Response> {
    if let Some(a) = auth {
        session::end(&state, &a.token_hash).await?;
    }
    Ok(([(header::SET_COOKIE, session::clear_header(&state)?)], StatusCode::NO_CONTENT).into_response())
}

#[derive(Deserialize)]
struct LabelBody {
    #[serde(default)]
    label: String,
}

async fn add_start(Extract(state): Extract<State>, auth: Authed, Json(b): Json<LabelBody>) -> ApiResult<Json<Started>> {
    hit(&state, "add-passkey", &auth.account.to_string(), 10, 600).await?;
    let account = account(&state, auth.account).await?;
    let existing = credential_ids(&state, account.id).await?;
    if existing.len() >= 10 {
        return Err(ApiError::bad("too_many_passkeys", "An account can hold 10 passkeys"));
    }
    let (options, reg) =
        state.webauthn.start_passkey_registration(account.id, &account.name, &account.name, Some(existing)).map_err(ApiError::internal)?;
    let label: String = names::normalize(&b.label).chars().take(40).collect();
    let ceremony = put_ceremony(&state, &Ceremony::Add { account: account.id, label, state: reg }).await?;
    Ok(Json(Started { ceremony, options: prefer_resident(to_json(&options)?) }))
}

async fn add_finish(Extract(state): Extract<State>, auth: Authed, Json(b): Json<FinishRegistration>) -> ApiResult<StatusCode> {
    let Ceremony::Add { account, label, state: reg } = take_ceremony(&state, &b.ceremony).await? else {
        return Err(ApiError::bad("ceremony_mismatch", "Wrong request"));
    };
    if account != auth.account {
        return Err(ApiError::unauthorized());
    }
    let passkey = state.webauthn.finish_passkey_registration(&b.credential, &reg).map_err(bad_credential)?;
    let label = if label.is_empty() { "passkey".to_owned() } else { label };
    riftwarden_db::accounts::add_passkey(&state.db, account, passkey.cred_id(), &to_json(&passkey)?, &label).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_passkey(Extract(state): Extract<State>, auth: Authed, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let cred = URL_SAFE_NO_PAD.decode(id.as_bytes()).map_err(|_| ApiError::bad("invalid_id", "Unknown passkey"))?;
    if riftwarden_db::accounts::delete_passkey(&state.db, auth.account, &cred).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::bad("last_passkey", "Keep at least one passkey (add another first)"))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CodeAnswer {
    recovery_code: String,
}

async fn new_recovery_code(Extract(state): Extract<State>, auth: Authed) -> ApiResult<Json<CodeAnswer>> {
    hit(&state, "recovery-code", &auth.account.to_string(), 5, 3600).await?;
    let code = recovery::generate();
    riftwarden_db::accounts::set_recovery(&state.db, auth.account, &hashed(&code).await?).await?;
    Ok(Json(CodeAnswer { recovery_code: code }))
}

async fn rename(Extract(state): Extract<State>, auth: Authed, Json(b): Json<NameBody>) -> ApiResult<Json<AccountView>> {
    let current = account(&state, auth.account).await?;
    if let Some(at) = current.renamed_at.map(|t| t + Duration::days(RENAME_COOLDOWN_DAYS)).filter(|t| *t > Utc::now()) {
        return Err(ApiError::bad("rename_cooldown", format!("You can rename again after {}", at.format("%Y-%m-%d"))));
    }
    let name = names::validate(&b.name).map_err(|r| ApiError::bad("invalid_name", r))?;
    riftwarden_db::accounts::rename(&state.db, auth.account, &name).await.map_err(|e| match e {
        riftwarden_db::DbError::Conflict => ApiError::conflict("name_taken", "That name is taken"),
        other => other.into(),
    })?;
    Ok(Json((&account(&state, auth.account).await?).into()))
}
