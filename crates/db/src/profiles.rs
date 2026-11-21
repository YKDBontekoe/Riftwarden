//! Profile documents (owned by the TypeScript rules; opaque JSON here) and per-device sync positions.

use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::DbError;

/// The account's profile, locked for the rest of the transaction (one sync at a time per account).
pub async fn lock(conn: &mut PgConnection, account: Uuid) -> Result<Option<(serde_json::Value, i64)>, DbError> {
    Ok(sqlx::query_as("SELECT doc, rev FROM profiles WHERE account_id = $1 FOR UPDATE").bind(account).fetch_optional(conn).await?)
}

pub async fn get(pool: &PgPool, account: Uuid) -> Result<Option<(serde_json::Value, i64)>, DbError> {
    Ok(sqlx::query_as("SELECT doc, rev FROM profiles WHERE account_id = $1").bind(account).fetch_optional(pool).await?)
}

/// Inserts or replaces the document; returns the new revision.
pub async fn store(conn: &mut PgConnection, account: Uuid, doc: &serde_json::Value, rules_version: i32) -> Result<i64, DbError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO profiles (account_id, doc, rev, rules_version) VALUES ($1, $2, 1, $3)
         ON CONFLICT (account_id) DO UPDATE SET doc = EXCLUDED.doc, rev = profiles.rev + 1, rules_version = EXCLUDED.rules_version, updated_at = now()
         RETURNING rev",
    )
    .bind(account)
    .bind(doc)
    .bind(rules_version)
    .fetch_one(conn)
    .await?)
}

/// Highest entry seq already applied from this device (0 = none), locked with the profile.
pub async fn device_seq(conn: &mut PgConnection, account: Uuid, device: &str) -> Result<i64, DbError> {
    let seq: Option<i64> = sqlx::query_scalar("SELECT last_seq FROM profile_devices WHERE account_id = $1 AND device = $2 FOR UPDATE")
        .bind(account)
        .bind(device)
        .fetch_optional(conn)
        .await?;
    Ok(seq.unwrap_or(0))
}

pub async fn set_device_seq(conn: &mut PgConnection, account: Uuid, device: &str, seq: i64) -> Result<(), DbError> {
    sqlx::query(
        "INSERT INTO profile_devices (account_id, device, last_seq) VALUES ($1, $2, $3)
         ON CONFLICT (account_id, device) DO UPDATE SET last_seq = GREATEST(profile_devices.last_seq, EXCLUDED.last_seq), updated_at = now()",
    )
    .bind(account)
    .bind(device)
    .bind(seq)
    .execute(conn)
    .await?;
    Ok(())
}
