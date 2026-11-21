//! The shared Rift War document (one row; shape owned by packages/rules: war/service.ts).

use sqlx::PgPool;

use crate::DbError;

pub async fn load(pool: &PgPool) -> Result<Option<serde_json::Value>, DbError> {
    Ok(sqlx::query_scalar("SELECT data FROM war_state WHERE id = 1").fetch_optional(pool).await?)
}

pub async fn save(pool: &PgPool, data: &serde_json::Value) -> Result<(), DbError> {
    sqlx::query("INSERT INTO war_state (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()")
        .bind(data)
        .execute(pool)
        .await?;
    Ok(())
}
