import { mkdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PGlite } from "@electric-sql/pglite";

/**
 * One database interface over two engines:
 *   - a Postgres server (postgres://…), for teams and production
 *   - PGlite, Postgres compiled to WebAssembly running inside the app
 *     (pglite:<folder> or pglite:memory), for the local app
 */
export interface DbResult<T> {
  rows: T[];
  rowCount: number | null;
}

export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<DbResult<T>>;
}

export interface DbClient extends Queryable {
  release(): void;
}

export interface Db extends Queryable {
  kind: "postgres" | "pglite";
  connect(): Promise<DbClient>;
  end(): Promise<void>;
  /** The embedded instance, when kind is "pglite". */
  pglite?: PGlite;
}

// bigint ids stay well under 2^53, so read them as plain numbers.
pg.types.setTypeParser(20, (v) => Number(v));

export function isEmbedded(databaseUrl: string): boolean {
  return databaseUrl.startsWith("pglite:");
}

export async function createDb(databaseUrl: string): Promise<Db> {
  return isEmbedded(databaseUrl) ? createEmbedded(databaseUrl) : createPostgres(databaseUrl);
}

/**
 * Accept connection strings copied from provider dashboards. PlanetScale's
 * psql examples add sslrootcert=system and sslnegotiation=direct, which
 * node-postgres doesn't understand (it would read "system" as a file);
 * verify-full against the system CAs is node's default for TLS anyway.
 */
export function pgConnectionString(databaseUrl: string): string {
  try {
    const u = new URL(databaseUrl);
    if (u.searchParams.get("sslrootcert") === "system") u.searchParams.delete("sslrootcert");
    u.searchParams.delete("sslnegotiation");
    return u.toString();
  } catch {
    return databaseUrl;
  }
}

function createPostgres(databaseUrl: string): Db {
  // Give up on an unreachable database quickly, so startup fails with a clear
  // reason instead of hanging past the host's health check.
  const pool = new pg.Pool({ connectionString: pgConnectionString(databaseUrl), max: 10, connectionTimeoutMillis: 15_000, keepAlive: true });
  pool.on("error", (err) => console.error("postgres pool error", err));
  return {
    kind: "postgres",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: (sql, params) => pool.query(sql, params as unknown[]) as Promise<DbResult<any>>,
    connect: () => pool.connect() as Promise<DbClient>,
    end: () => pool.end(),
  };
}

/**
 * PGlite has a single connection, so transactions must not interleave. A
 * mutex hands out that connection to one transaction (or one query) at a time.
 */
async function createEmbedded(databaseUrl: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const where = databaseUrl.slice("pglite:".length);
  let instance: PGlite;
  if (where === "" || where === "memory" || where === "memory://") {
    instance = await PGlite.create();
  } else {
    const dir = resolve(where);
    mkdirSync(dir, { recursive: true });
    instance = await PGlite.create(dir);
  }

  let tail: Promise<void> = Promise.resolve();
  const lock = async (): Promise<() => void> => {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = tail;
    tail = prev.then(() => next);
    await prev;
    return release;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = async <T = any>(sql: string, params?: unknown[]): Promise<DbResult<T>> => {
    if (params && params.length > 0) {
      const r = await instance.query<T>(sql, params);
      return { rows: r.rows, rowCount: countOf(r) };
    }
    // No parameters: may be several statements (migrations), so use exec.
    const results = await instance.exec(sql);
    const last = results[results.length - 1];
    return { rows: (last?.rows ?? []) as T[], rowCount: last ? countOf(last) : 0 };
  };

  return {
    kind: "pglite",
    pglite: instance,
    async query(sql, params) {
      const release = await lock();
      try {
        return await run(sql, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await lock();
      let released = false;
      return {
        query: run,
        release() {
          if (!released) {
            released = true;
            release();
          }
        },
      };
    },
    async end() {
      const release = await lock();
      try {
        await instance.close();
      } finally {
        release();
      }
    },
  };
}

/** Match Postgres: rows returned for SELECT, rows affected for writes. */
function countOf(r: { rows: unknown[]; affectedRows?: number }): number {
  return Math.max(r.affectedRows ?? 0, r.rows.length);
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
export async function tx<T>(db: Db, fn: (c: DbClient) => Promise<T>): Promise<T> {
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

/** Where a connection string points, without its password, for error messages. */
export function describeDatabase(databaseUrl: string): string {
  if (isEmbedded(databaseUrl)) return databaseUrl;
  try {
    const u = new URL(databaseUrl);
    return `${u.protocol}//${decodeURIComponent(u.username) || "(no user)"}@${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "(DATABASE_URL isn't a valid URL)";
  }
}

/** A plain reason and what to check, for a database error at startup. */
export function databaseHint(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const m = `${e.code ?? ""} ${e.message ?? ""}`;
  if (/28P01|password authentication failed/i.test(m)) return "The database rejected the user name or password. Copy both again from the database's Connect page into DATABASE_URL.";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "The database host name doesn't exist. Check the host part of DATABASE_URL.";
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(m)) return "Couldn't reach the database. Check the host and that the port is 5432.";
  if (/3D000|database .* does not exist/i.test(m)) return "That database name doesn't exist. For PlanetScale it's usually /postgres at the end of DATABASE_URL.";
  if (/42501|permission denied/i.test(m)) return "The database user can't create tables. Use a role with full access.";
  if (/self.signed|certificate|SSL|TLS/i.test(m)) return "The secure connection failed. Keep ?sslmode=verify-full at the end of DATABASE_URL.";
  return "";
}
