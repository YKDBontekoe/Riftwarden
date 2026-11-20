import { readFile } from 'node:fs/promises';
import pg, { type PoolClient } from 'pg';
import type { SaveData } from '../src/progression/save';
import { encodeRows, profileHeader, profileRelations, profileTables, readProfile, snakeCase, type Relations, type Row } from './profileRows';

const migrations = ['001_profiles.sql', '002_progress.sql', '003_secondary_weapon.sql', '004_abilities.sql', '005_elements.sql'].map((file) => new URL(`./migrations/${file}`, import.meta.url));
const loadQuery = `
  SELECT to_jsonb(p) AS header, json_build_object(
    ${profileTables.map((table) => `'${table}', COALESCE((SELECT json_agg(t) FROM ${table} t WHERE t.player_id = p.player_id), '[]'::json)`).join(',\n')}
  ) AS relations
  FROM profiles p WHERE p.player_id = $1
`;

export interface ProfileWrite {
  id: string;
  revision: number | null;
  data: SaveData;
  before?: SaveData;
}

/** PostgreSQL owns the durable state. Each change to a profile commits across every affected table. */
export class ProfileDatabase {
  private readonly pool: pg.Pool;

  constructor(onError: (error: Error) => void) {
    this.pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    });
    this.pool.on('error', onError);
  }

  async migrate(): Promise<void> {
    const sqls = await Promise.all(migrations.map((url) => readFile(url, 'utf8')));
    await this.transaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(41314, 1)');
      await db.query('CREATE TABLE IF NOT EXISTS riftwarden_schema_migrations (version integer PRIMARY KEY)');
      for (const [i, sql] of sqls.entries()) {
        const version = i + 1;
        const { rowCount } = await db.query('SELECT 1 FROM riftwarden_schema_migrations WHERE version = $1', [version]);
        if (rowCount) continue;
        await db.query(sql);
        await db.query('INSERT INTO riftwarden_schema_migrations (version) VALUES ($1)', [version]);
      }
    });
  }

  async load(id: string): Promise<ReturnType<typeof readProfile> | null> {
    const { rows: [row] } = await this.pool.query<{ header: Row; relations: Relations }>(loadQuery, [id]);
    return row ? readProfile(row.header, row.relations) : null;
  }

  async save(writes: ProfileWrite[]): Promise<void> {
    await this.transaction(async (db) => {
      // Lock profiles in a consistent order. The revision check protects against stale snapshots.
      for (const write of [...writes].sort((a, b) => a.id.localeCompare(b.id))) {
        const { id, revision, data, before } = write;
        const header = profileHeader(data);
        const cols = Object.keys(header).map(snakeCase);
        const json = encodeRows([{ playerId: id, ...header }]);
        const writeHeader = revision === null
          ? await db.query(`INSERT INTO profiles (player_id, ${cols.join(', ')})
              SELECT player_id, ${cols.join(', ')} FROM jsonb_populate_recordset(NULL::profiles, $1)`, [json])
          : await db.query(`UPDATE profiles p SET revision = p.revision + 1, ${cols.map((k) => `${k} = incoming.${k}`).join(', ')}
              FROM jsonb_populate_recordset(NULL::profiles, $1) incoming
              WHERE p.player_id = incoming.player_id AND p.revision = $2`, [json, revision]);
        if (writeHeader.rowCount !== 1) throw new Error('Profile revision conflict');

        const rows = profileRelations(data);
        const previous = before && profileRelations(before);
        for (const table of profileTables) {
          const next = encodeRows(rows[table].map((row) => ({ playerId: id, ...row })));
          if (previous && next === encodeRows(previous[table].map((row) => ({ playerId: id, ...row })))) continue;
          if (previous?.[table].length) await db.query(`DELETE FROM ${table} WHERE player_id = $1`, [id]);
          if (rows[table].length) {
            await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1)`, [next]);
          }
        }
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async transaction<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    let releaseError: Error | undefined;
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        releaseError = rollbackError as Error;
      }
      throw error;
    } finally {
      db.release(releaseError);
    }
  }
}
