#!/usr/bin/env node
// Sitecraft as a local app: one command, no Docker, no separate database.
//
//   pnpm start               start (builds first if the code changed)
//   pnpm start --no-open     don't open the browser
//   pnpm start --rebuild     force a fresh build
//
// Data lives in ~/.sitecraft (or SITECRAFT_DATA): the database, uploaded
// images, published files and this app's secrets. Copy the folder to back up.
import { spawn, spawnSync, execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = new Set(process.argv.slice(2));
const dataDir = resolve(process.env.SITECRAFT_DATA ?? join(homedir(), ".sitecraft"));
const port = Number(process.env.SITECRAFT_PORT ?? 4000);
const mcpPort = Number(process.env.SITECRAFT_MCP_PORT ?? 4100);
const appUrl = `http://localhost:${port}`;
const mcpUrl = `http://localhost:${mcpPort}/mcp`;
const pnpm = platform() === "win32" ? "pnpm.cmd" : "pnpm";

const say = (msg = "") => process.stdout.write(msg + "\n");
const fail = (msg) => {
  process.stderr.write(`\n${msg}\n\n`);
  process.exit(1);
};

// 1. Dependencies and build.
if (!existsSync(join(root, "node_modules"))) {
  say("Installing dependencies (first run only)…");
  if (spawnSync(pnpm, ["install"], { cwd: root, stdio: "inherit" }).status !== 0) fail("Installing dependencies failed. Fix the error above, then run pnpm start again.");
}

const stamp = join(root, "node_modules", ".sitecraft-build");
const head = (() => {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
})();
const outputs = ["apps/api/dist/main.js", "apps/mcp/dist/main.js", "apps/editor/dist/index.html"].map((p) => join(root, p));
const built = outputs.every(existsSync) && existsSync(stamp) && readFileSync(stamp, "utf8") === head;
if (!built || args.has("--rebuild")) {
  say("Building Sitecraft (about a minute the first time)…");
  if (spawnSync(pnpm, ["build"], { cwd: root, stdio: "inherit" }).status !== 0) fail("The build failed. Fix the error above, then run pnpm start again.");
  writeFileSync(stamp, head);
}

// 2. Data folder and this computer's secrets.
mkdirSync(dataDir, { recursive: true });
const configPath = join(dataDir, "config.json");
let config = {};
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    fail(`${configPath} isn't valid JSON. Fix it or delete it (a new one is created).`);
  }
}
let changed = false;
if (!config.secret) (config.secret = randomBytes(32).toString("hex")), (changed = true);
if (!config.agentToken) (config.agentToken = "sc_local_" + randomBytes(24).toString("base64url")), (changed = true);
if (changed) {
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  try {
    chmodSync(configPath, 0o600);
  } catch {
    /* not supported on this file system */
  }
}

// 3. Ports must be free.
const free = (p) =>
  new Promise((ok) => {
    const s = createServer()
      .once("error", () => ok(false))
      .once("listening", () => s.close(() => ok(true)))
      .listen(p, "127.0.0.1");
  });
for (const [p, envName] of [
  [port, "SITECRAFT_PORT"],
  [mcpPort, "SITECRAFT_MCP_PORT"],
]) {
  if (!(await free(p))) fail(`Port ${p} is already in use. Is Sitecraft already running? Stop it, or pick another port: ${envName}=${p + 10} pnpm start`);
}

// 4. Start the app and the MCP server.
const children = [];
const start = (name, script, extraArgs, env) => {
  const child = spawn(process.execPath, [join(root, script), ...extraArgs], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    process.stderr.write(`\nThe ${name} stopped (${signal ?? `exit code ${code}`}). Shutting down.\n`);
    shutdown(1);
  });
  children.push(child);
  return child;
};

let shuttingDown = false;
const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500).unref();
};
process.on("SIGINT", () => (say("\nStopping Sitecraft…"), shutdown(0)));
process.on("SIGTERM", () => shutdown(0));

start("app", "apps/api/dist/main.js", [], {
  SITECRAFT_LOCAL: "1",
  PORT: String(port),
  HOST: "127.0.0.1",
  DATABASE_URL: `pglite:${join(dataDir, "db")}`,
  STORAGE_DRIVER: "fs",
  STORAGE_DIR: join(dataDir, "storage"),
  EDITOR_DIST: join(root, "apps/editor/dist"),
  PUBLIC_URL: appUrl,
  EDITOR_URL: appUrl,
  CORS_ORIGINS: `${appUrl},http://127.0.0.1:${port}`,
  SECRET: config.secret,
  AGENT_TOKEN: config.agentToken,
  LOG_LEVEL: process.env.LOG_LEVEL ?? "warn",
});

const up = async (url) => {
  for (let i = 0; i < 120; i++) {
    if (await fetch(url).then((r) => r.ok).catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
if (!(await up(`${appUrl}/healthz`))) {
  fail(`Sitecraft didn't start. If the message above mentions the database, the data folder may be damaged: move ${join(dataDir, "db")} aside and try again.`);
}

start("MCP server", "apps/mcp/dist/main.js", ["--http"], {
  PORT: String(mcpPort),
  HOST: "127.0.0.1",
  SITECRAFT_API_URL: appUrl,
  SITECRAFT_LOCAL_AGENT_TOKEN: config.agentToken,
});
if (!(await up(`http://localhost:${mcpPort}/healthz`))) fail("The MCP server didn't start. See the message above.");

// 5. Ready.
say(`
  Sitecraft is running

  Editor        ${appUrl}
  Your data     ${dataDir}

  Connect Claude Code (once):
    claude mcp add --transport http --scope user sitecraft ${mcpUrl}

  Press Ctrl+C to stop.
`);

if (!args.has("--no-open") && !process.env.CI) {
  const opener = platform() === "darwin" ? ["open", [appUrl]] : platform() === "win32" ? ["cmd", ["/c", "start", "", appUrl]] : ["xdg-open", [appUrl]];
  try {
    spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser to open; the address is printed above */
  }
}
