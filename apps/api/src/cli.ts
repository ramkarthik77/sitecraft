import { createStarterDocument } from "@sitecraft/schema";
import { createToken, type Role } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDb, migrate } from "./db.js";
import { Repo } from "./repo.js";

const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();
const db = await createDb(cfg.databaseUrl);

try {
  if (cmd === "migrate") {
    const applied = await migrate(db);
    console.log(applied.length ? `Applied ${applied.join(", ")}` : "Database is up to date.");
  } else if (cmd === "token") {
    // pnpm --filter @sitecraft/api exec tsx src/cli.ts token "Jane" editor
    const [name, role] = args;
    if (!name || !["admin", "editor", "agent"].includes(role ?? "")) throw new Error('Usage: token "<name>" <admin|editor|agent>');
    await migrate(db);
    console.log(await createToken(db, name, role as Role));
  } else if (cmd === "seed") {
    await migrate(db);
    const repo = new Repo(db);
    const existing = await repo.listSites();
    if (existing.some((s) => s.slug === "acme")) {
      console.log("Demo site already exists.");
    } else {
      const site = await repo.createSite({ name: "seed", role: "admin" }, { name: "Acme", slug: "acme", document: createStarterDocument({ name: "Acme", template: "saas" }) });
      console.log(`Created demo site ${site.slug} (${site.id})`);
    }
  } else {
    console.log("Commands: migrate | seed | token <name> <role>");
  }
} finally {
  await db.end();
}
