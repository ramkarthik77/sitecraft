#!/usr/bin/env node
// End-to-end run: builds everything, starts the API (serving the editor) on a
// fresh database, then drives the editor in a real browser with Playwright.
//
//   DATABASE_URL=postgres://sitecraft:sitecraft@localhost:5432/sitecraft_e2e pnpm test:e2e
//
// The database is wiped first, so point it at a throwaway database.
import { spawn, execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

const root = new URL("..", import.meta.url).pathname;
const port = Number(process.env.E2E_PORT ?? 4300);
const db = process.env.DATABASE_URL ?? "postgres://sitecraft:sitecraft@localhost:5432/sitecraft_e2e";
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });

// Create the database if needed, then wipe it.
const url = new URL(db);
const dbName = url.pathname.slice(1);
const admin = new pg.Client({ connectionString: Object.assign(new URL(db), { pathname: "/postgres" }).toString() });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
await admin.end();
const c = new pg.Client({ connectionString: db });
await c.connect();
await c.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
await c.end();

run("pnpm build");

const env = {
  ...process.env,
  PORT: String(port),
  DATABASE_URL: db,
  PUBLIC_URL: `http://localhost:${port}`,
  EDITOR_URL: `http://localhost:${port}`,
  CORS_ORIGINS: `http://localhost:${port}`,
  EDITOR_DIST: join(root, "apps/editor/dist"),
  STORAGE_DRIVER: "fs",
  STORAGE_DIR: mkdtempSync(join(tmpdir(), "sitecraft-e2e-")),
  ADMIN_TOKEN: "e2e-admin",
  EDITOR_TOKEN: "e2e-editor",
  AGENT_TOKEN: "e2e-agent",
  LOG_LEVEL: "warn",
};
const api = spawn("node", ["apps/api/dist/main.js"], { cwd: root, env, stdio: "inherit" });

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  up = await fetch(`http://localhost:${port}/healthz`).then((r) => r.ok).catch(() => false);
}
if (!up) {
  api.kill();
  throw new Error("API didn't start");
}

let code = 1;
try {
  run(`npx playwright test ${process.argv.slice(2).join(" ")}`);
  code = 0;
} catch {
  code = 1;
} finally {
  api.kill();
}
process.exit(code);
