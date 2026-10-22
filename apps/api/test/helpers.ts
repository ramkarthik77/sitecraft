import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { loadConfig, type Config } from "../src/config.js";
import { buildServer } from "../src/server.js";

export const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgres://sitecraft:sitecraft@localhost:5432/sitecraft_test";
export const ADMIN = "test-admin-token";
export const EDITOR = "test-editor-token";
export const AGENT = "test-agent-token";

export async function resetDb() {
  // An in-memory embedded database starts empty with every server.
  if (TEST_DB.startsWith("pglite:")) return;
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await c.end();
}

export async function startTestServer(overrides: Partial<Record<string, string>> = {}) {
  const dir = await mkdtemp(join(tmpdir(), "sitecraft-storage-"));
  const cfg: Config = loadConfig({
    DATABASE_URL: TEST_DB,
    STORAGE_DIR: dir,
    ...(process.env.TEST_S3_ENDPOINT
      ? { STORAGE_DRIVER: "s3", S3_ENDPOINT: process.env.TEST_S3_ENDPOINT, S3_BUCKET: "sitecraft-test", S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test" }
      : {}),
    ADMIN_TOKEN: ADMIN,
    EDITOR_TOKEN: EDITOR,
    AGENT_TOKEN: AGENT,
    PUBLIC_URL: "http://localhost:4000",
    SECRET: "test-secret-test-secret-test-secret-123",
    ...overrides,
  } as NodeJS.ProcessEnv);
  const { app, ctx } = await buildServer(cfg);
  return { app, ctx, cfg };
}

export const auth = (t: string) => ({ authorization: `Bearer ${t}` });
