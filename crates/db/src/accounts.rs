//! Accounts, passkeys, recovery codes and sessions (architecture v2 section 6).

use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

use crate::DbError;

#[derive(Debug, Clone, FromRow, PartialEq, Eq)]
pub struct Account {
    pub id: Uuid,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub renamed_at: Option<DateTime<Utc>>,
    pub admin: bool,
}

#[derive(Debug, Clone, FromRow)]
pub struct StoredPasskey {
    pub credential_id: Vec<u8>,
    pub account_id: Uuid,
    pub passkey: serde_json::Value,
    pub label: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

fn unique(e: sqlx::Error) -> DbError {
    match &e {
        sqlx::Error::Database(d) if d.is_unique_violation() => DbError::Conflict,
        _ => DbError::Sqlx(e),
    }
}

macro_rules! account_cols {
    () => {
        "id, name, created_at, renamed_at, admin"
    };
}

pub async fn account_by_id(pool: &PgPool, id: Uuid) -> Result<Option<Account>, DbError> {
    Ok(sqlx::query_as(concat!("SELECT ", account_cols!(), " FROM accounts WHERE id = $1")).bind(id).fetch_optional(pool).await?)
}

pub async fn account_by_name(pool: &PgPool, name: &str) -> Result<Option<Account>, DbError> {
    Ok(sqlx::query_as(concat!("SELECT ", account_cols!(), " FROM accounts WHERE name_key = lower($1)"))
        .bind(name)
        .fetch_optional(pool)
        .await?)
}

/// Creates the account with its first passkey and recovery code in one transaction.
/// `DbError::Conflict` when the name (or the credential) is already taken.
pub async fn create_account(
    pool: &PgPool,
    id: Uuid,
    name: &str,
    credential_id: &[u8],
    passkey: &serde_json::Value,
    recovery_hash: &str,
) -> Result<Account, DbError> {
    let mut tx = pool.begin().await?;
    let account: Account =
        sqlx::query_as(concat!("INSERT INTO accounts (id, name, name_key) VALUES ($1, $2, lower($2)) RETURNING ", account_cols!(), ""))
            .bind(id)
            .bind(name)
            .fetch_one(&mut *tx)
            .await
            .map_err(unique)?;
    sqlx::query("INSERT INTO passkeys (credential_id, account_id, passkey, label) VALUES ($1, $2, $3, 'first passkey')")
        .bind(credential_id)
        .bind(id)
        .bind(passkey)
        .execute(&mut *tx)
        .await
        .map_err(unique)?;
    sqlx::query("INSERT INTO recovery_codes (account_id, code_hash) VALUES ($1, $2)")
        .bind(id)
        .bind(recovery_hash)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(account)
}

/// Renames the account (unique names; the caller enforces the cooldown).
pub async fn rename(pool: &PgPool, id: Uuid, name: &str) -> Result<(), DbError> {
    sqlx::query("UPDATE accounts SET name = $2, name_key = lower($2), renamed_at = now() WHERE id = $1")
        .bind(id)
        .bind(name)
        .execute(pool)
        .await
        .map_err(unique)?;
    Ok(())
}

pub async fn passkeys(pool: &PgPool, account: Uuid) -> Result<Vec<StoredPasskey>, DbError> {
    Ok(sqlx::query_as(
        "SELECT credential_id, account_id, passkey, label, created_at, last_used_at FROM passkeys WHERE account_id = $1 ORDER BY created_at",
    )
    .bind(account)
    .fetch_all(pool)
    .await?)
}

pub async fn add_passkey(
    pool: &PgPool,
    account: Uuid,
    credential_id: &[u8],
    passkey: &serde_json::Value,
    label: &str,
) -> Result<(), DbError> {
    sqlx::query("INSERT INTO passkeys (credential_id, account_id, passkey, label) VALUES ($1, $2, $3, $4)")
        .bind(credential_id)
        .bind(account)
        .bind(passkey)
        .bind(label)
        .execute(pool)
        .await
        .map_err(unique)?;
    Ok(())
}

/// Stores the updated credential (signature counter) after a sign-in.
pub async fn touch_passkey(pool: &PgPool, credential_id: &[u8], passkey: Option<&serde_json::Value>) -> Result<(), DbError> {
    sqlx::query("UPDATE passkeys SET last_used_at = now(), passkey = COALESCE($2, passkey) WHERE credential_id = $1")
        .bind(credential_id)
        .bind(passkey)
        .execute(pool)
        .await?;
    Ok(())
}

/// Removes a passkey unless it is the account's last one. Returns false when nothing was removed.
pub async fn delete_passkey(pool: &PgPool, account: Uuid, credential_id: &[u8]) -> Result<bool, DbError> {
    let r = sqlx::query(
        "DELETE FROM passkeys WHERE account_id = $1 AND credential_id = $2 AND (SELECT count(*) FROM passkeys WHERE account_id = $1) > 1",
    )
    .bind(account)
    .bind(credential_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn recovery_hash(pool: &PgPool, account: Uuid) -> Result<Option<String>, DbError> {
    Ok(sqlx::query_scalar("SELECT code_hash FROM recovery_codes WHERE account_id = $1").bind(account).fetch_optional(pool).await?)
}

pub async fn set_recovery(pool: &PgPool, account: Uuid, hash: &str) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO recovery_codes (account_id, code_hash) VALUES ($1, $2)
         ON CONFLICT (account_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, created_at = now()",
    )
    .bind(account)
    .bind(hash)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn create_session(
    pool: &PgPool,
    token_hash: &[u8],
    account: Uuid,
    expires_at: DateTime<Utc>,
    user_agent: &str,
) -> Result<(), DbError> {
    sqlx::query("INSERT INTO sessions (token_hash, account_id, expires_at, user_agent) VALUES ($1, $2, $3, $4)")
        .bind(token_hash)
        .bind(account)
        .bind(expires_at)
        .bind(user_agent)
        .execute(pool)
        .await?;
    Ok(())
}

/// The account of a live session; slides its expiry to `extend_to`.
pub async fn session_account(pool: &PgPool, token_hash: &[u8], extend_to: DateTime<Utc>) -> Result<Option<Uuid>, DbError> {
    Ok(sqlx::query_scalar(
        "UPDATE sessions SET last_seen_at = now(), expires_at = GREATEST(expires_at, $2)
         WHERE token_hash = $1 AND expires_at > now() RETURNING account_id",
    )
    .bind(token_hash)
    .bind(extend_to)
    .fetch_optional(pool)
    .await?)
}

pub async fn delete_session(pool: &PgPool, token_hash: &[u8]) -> Result<(), DbError> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = $1").bind(token_hash).execute(pool).await?;
    Ok(())
}

/// Signs the account out everywhere except the given session (after a recovery); returns the removed token hashes.
pub async fn delete_other_sessions(pool: &PgPool, account: Uuid, keep: &[u8]) -> Result<Vec<Vec<u8>>, DbError> {
    Ok(sqlx::query_scalar("DELETE FROM sessions WHERE account_id = $1 AND token_hash <> $2 RETURNING token_hash")
        .bind(account)
        .bind(keep)
        .fetch_all(pool)
        .await?)
}

pub async fn purge_expired_sessions(pool: &PgPool) -> Result<u64, DbError> {
    Ok(sqlx::query("DELETE FROM sessions WHERE expires_at <= now()").execute(pool).await?.rows_affected())
}
