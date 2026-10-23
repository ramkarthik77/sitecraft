import { loadConfig } from "./config.js";
import { databaseHint, describeDatabase } from "./db.js";
import { buildServer } from "./server.js";

// One clear line for anything that stops the server starting, so it's easy to
// find in host logs (Cloudflare, Docker), instead of a bare stack trace.
const fail = (what: string, err: unknown, hint = ""): never => {
  console.error(`Sitecraft startup failed: ${what}: ${(err as Error)?.message ?? err}${hint ? `\n  ${hint}` : ""}`);
  process.exit(1);
};

let cfg: ReturnType<typeof loadConfig>;
try {
  cfg = loadConfig();
} catch (e) {
  fail("settings", e);
}
console.log(`Sitecraft starting: database ${describeDatabase(cfg!.databaseUrl)}, storage ${cfg!.storage.driver}`);
const { app } = await buildServer(cfg!, { logger: true }).catch((e) => fail("couldn't start", e, databaseHint(e)));

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: cfg!.port, host: cfg!.host });
app.log.info(`Sitecraft API on ${cfg!.publicUrl} (storage: ${cfg!.storage.driver})`);
