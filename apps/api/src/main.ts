import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const cfg = loadConfig();
const { app } = await buildServer(cfg, { logger: true });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

await app.listen({ port: cfg.port, host: cfg.host });
app.log.info(`Sitecraft API on ${cfg.publicUrl} (storage: ${cfg.storage.driver})`);
