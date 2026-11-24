//! Leaderboards read straight from the rules-owned profile documents: the rules keep a `board` summary
//! (`{rl, wave, waveRl, at}`) on every document when a checkpoint banks, so only server-validated progress
//! (solo runs checked by the rules worker, co-op runs simulated on the server) ever reaches a board.

use sqlx::PgPool;

use crate::DbError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// The running season's seasonal profiles (`doc.seasonal` with the given id).
    Season(i32),
    /// Permanent profiles (all time).
    Permanent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Metric {
    /// Highest Rift Level unlocked (ties: deepest wave).
    RiftLevel,
    /// Deepest wave cleared (ties: the level it was cleared on).
    Wave,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Row {
    pub name: String,
    pub rl: i64,
    pub wave: i64,
    #[serde(rename = "waveRl")]
    pub wave_rl: i64,
}

macro_rules! board_sql {
    ($board:literal, $filter:literal, $order:literal) => {
        concat!(
            "SELECT a.name, (",
            $board,
            "->>'rl')::bigint AS rl, (",
            $board,
            "->>'wave')::bigint AS wave, COALESCE((",
            $board,
            "->>'waveRl')::bigint, 0) AS wave_rl ",
            "FROM profiles p JOIN accounts a ON a.id = p.account_id ",
            "WHERE ",
            $board,
            " IS NOT NULL AND ",
            $filter,
            " ",
            "ORDER BY ",
            $order,
            ", a.name ASC LIMIT $1"
        )
    };
}

// Fixed statements (no string building at run time): only the limit and the season id are bound.
const SEASON_RL: &str = board_sql!("p.doc->'seasonal'->'doc'->'board'", "(p.doc->'seasonal'->>'id')::int = $2", "rl DESC, wave DESC");
const SEASON_WAVE: &str =
    board_sql!("p.doc->'seasonal'->'doc'->'board'", "(p.doc->'seasonal'->>'id')::int = $2", "wave DESC, wave_rl DESC");
const ALL_RL: &str = board_sql!("p.doc->'board'", "$2::int IS NOT NULL", "rl DESC, wave DESC");
const ALL_WAVE: &str = board_sql!("p.doc->'board'", "$2::int IS NOT NULL", "wave DESC, wave_rl DESC");

/// Top `limit` wardens of a board.
pub async fn top(pool: &PgPool, scope: Scope, metric: Metric, limit: i64) -> Result<Vec<Row>, DbError> {
    let (sql, season) = match (scope, metric) {
        (Scope::Season(s), Metric::RiftLevel) => (SEASON_RL, s),
        (Scope::Season(s), Metric::Wave) => (SEASON_WAVE, s),
        (Scope::Permanent, Metric::RiftLevel) => (ALL_RL, 0),
        (Scope::Permanent, Metric::Wave) => (ALL_WAVE, 0),
    };
    let rows: Vec<(String, i64, i64, i64)> = sqlx::query_as(sql).bind(limit).bind(season).fetch_all(pool).await?;
    Ok(rows.into_iter().map(|(name, rl, wave, wave_rl)| Row { name, rl, wave, wave_rl }).collect())
}
