import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Db = pg.Pool;

// bigint ids stay well under 2^53, so read them as plain numbers.
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(databaseUrl: string): Db {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  pool.on("error", (err) => console.error("postgres pool error", err));
  return pool;
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Apply any SQL migrations that haven't run yet, in filename order. */
export async function migrate(db: Db): Promise<string[]> {
  const client = await db.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(MIGRATIONS_DIR, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
}

/** Run fn inside a transaction. */
export async function tx<T>(db: Db, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
