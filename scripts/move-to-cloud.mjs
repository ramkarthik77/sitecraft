#!/usr/bin/env node
// Copy sites from the local app (pnpm start) to a Sitecraft in the cloud.
//
//   SITECRAFT_TOKEN=<admin or editor token> pnpm move-to-cloud
//
// Options:
//   --to <url>        cloud address (default SITECRAFT_CLOUD_URL, else the workers.dev app)
//   --from <url>      local app address (default http://localhost:4000)
//   --site <slug>     only this site (repeat for more)
//   --rename          copy a site whose address is taken in the cloud under a new one
//   --publish         publish each copied site in the cloud if it was published locally
//   --dry-run         show what would be copied, change nothing
//
// Copies each site's current main version: pages, design, CMS collections and
// items, and the uploaded images it uses. Branches, history and form
// submissions stay on this computer.

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const values = (name) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));
const strip = (u) => u.replace(/\/+$/, "");

const from = strip(values("--from")[0] ?? process.env.SITECRAFT_LOCAL_URL ?? "http://localhost:4000");
const to = strip(values("--to")[0] ?? process.env.SITECRAFT_CLOUD_URL ?? "https://sitecraft.guduriphaniram1988.workers.dev");
const token = process.env.SITECRAFT_TOKEN ?? "";
const only = new Set(values("--site"));
const dryRun = flag("--dry-run");
const rename = flag("--rename");
const publish = flag("--publish");

const say = (m = "") => process.stdout.write(m + "\n");
const fail = (m) => {
  process.stderr.write(`\n${m}\n\n`);
  process.exit(1);
};

if (flag("--help") || flag("-h")) {
  say(
    "Usage: SITECRAFT_TOKEN=<token> pnpm move-to-cloud [--to <url>] [--from <url>] [--site <slug>] [--rename] [--publish] [--dry-run]",
  );
  process.exit(0);
}
if (!token && !dryRun) fail("Set SITECRAFT_TOKEN to an admin or editor token for the cloud app, for example:\n  SITECRAFT_TOKEN=sc_admin_… pnpm move-to-cloud");
if (strip(from) === strip(to)) fail("--from and --to are the same address.");

async function call(base, method, path, { body, auth = false, raw } = {}) {
  const headers = {};
  if (auth) headers.authorization = `Bearer ${token}`;
  if (raw) headers["content-type"] = raw.type;
  else if (body !== undefined) headers["content-type"] = "application/json";
  let res;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    const where = base === from ? "the local app. Is pnpm start running?" : `${to}. Check the address and your connection.`;
    throw new Error(`Couldn't reach ${where} (${e.cause?.code ?? e.message})`);
  }
  const text = await res.text();
  let data = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const err = new Error(typeof data === "object" && data?.error ? `${data.error}${data.errors ? ` ${data.errors.join("; ")}` : ""}` : `${method} ${path} failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const local = (method, path, opts) => call(from, method, path, opts);
const cloud = (method, path, opts) => call(to, method, path, { ...opts, auth: true });

// Who are we, on both ends?
const meLocal = await local("GET", "/api/me").catch((e) => fail(e.status === 403 || e.status === 401 ? `${from} isn't the local app (it asked for sign-in). Use --from with the address pnpm start prints.` : e.message));
if (!meLocal.local) fail(`${from} isn't running as the local app. Start it with pnpm start, or pass --from.`);
if (!dryRun) {
  const meCloud = await cloud("GET", "/api/me").catch((e) => fail(e.status === 401 ? `The cloud app at ${to} didn't accept SITECRAFT_TOKEN.` : e.message));
  if (meCloud.role === "agent") fail("That token is an agent token. Use an admin or editor token; agents can't create sites on main.");
  say(`Copying from ${from} to ${to} as ${meCloud.name}.`);
} else say(`Dry run: copying from ${from} to ${to}. Nothing will change.`);

const sites = (await local("GET", "/api/sites")).filter((s) => only.size === 0 || only.has(s.slug) || only.has(s.id));
if (only.size && sites.length < only.size) {
  const found = new Set(sites.flatMap((s) => [s.slug, s.id]));
  fail(`Not found locally: ${[...only].filter((x) => !found.has(x)).join(", ")}`);
}
if (sites.length === 0) fail("There are no sites in the local app to copy.");

const MEDIA = /https?:\/\/[^"'\s)]+\/media\/([0-9a-f-]{36})\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))/gi;
const LIBRARY = /https?:\/\/[^"'\s)]+\/media\/library\/([0-9a-f-]{36}\.(?:png|jpg|gif|webp))/gi;
// Library images used by several sites are copied once.
const copiedLibrary = new Map();
const TYPES = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const results = [];

for (const site of sites) {
  const label = `${site.name} (${site.slug})`;
  try {
    const head = await local("GET", `/api/sites/${site.id}/branches/main`);
    let json = JSON.stringify(head.document);
    const images = new Map();
    for (const m of json.matchAll(MEDIA)) if (m[1] === site.id) images.set(m[0], m[2]);
    const libraryImages = new Map();
    for (const m of json.matchAll(LIBRARY)) if (m[0].startsWith(from)) libraryImages.set(m[0], m[1]);
    const items = (head.document.collections ?? []).reduce((n, c) => n + c.items.length, 0);
    const what = `${head.document.pages.length} pages, ${(head.document.collections ?? []).length} collections, ${items} items, ${images.size + libraryImages.size} images`;
    if (dryRun) {
      say(`  would copy ${label}: ${what}`);
      results.push({ label, ok: true });
      continue;
    }

    // 1. The site, with the document as it is here.
    let created;
    try {
      created = await cloud("POST", "/api/sites", { body: { name: site.name, slug: site.slug, document: head.document } });
    } catch (e) {
      if (e.status !== 409) throw e;
      if (!rename) {
        say(`  skipped ${label}: the address ${site.slug} is already used in the cloud. Run again with --rename to copy it under a new one.`);
        results.push({ label, ok: false, skipped: true });
        continue;
      }
      created = await cloud("POST", "/api/sites", { body: { name: site.name, document: head.document } });
    }

    // 2. Its images, then point the document at their new addresses.
    for (const [oldUrl, file] of images) {
      const res = await fetch(`${from}/media/${site.id}/${file}`);
      if (!res.ok) {
        say(`    warning: image ${file} is missing locally; left as is`);
        continue;
      }
      const ext = file.split(".").pop().toLowerCase();
      const up = await cloud("POST", `/api/sites/${created.id}/assets?filename=${encodeURIComponent(file)}`, { raw: { type: TYPES[ext], data: Buffer.from(await res.arrayBuffer()) } });
      json = json.split(oldUrl).join(up.url);
    }
    for (const [oldUrl, file] of libraryImages) {
      if (!copiedLibrary.has(file)) {
        const res = await fetch(`${from}/media/library/${file}`);
        if (!res.ok) {
          say(`    warning: library image ${file} is missing locally; left as is`);
          continue;
        }
        const meta = (await local("GET", "/api/assets?limit=500")).find((a) => a.url.endsWith(file)) ?? {};
        const ext = file.split(".").pop().toLowerCase();
        const q = new URLSearchParams({ filename: meta.fileName ?? file, title: meta.title ?? "", alt: meta.alt ?? "", tags: (meta.tags ?? []).join(",") });
        const up = await cloud("POST", `/api/assets?${q}`, { raw: { type: TYPES[ext], data: Buffer.from(await res.arrayBuffer()) } });
        copiedLibrary.set(file, up.url);
      }
      json = json.split(oldUrl).join(copiedLibrary.get(file));
    }
    if (images.size || libraryImages.size) {
      const now = await cloud("GET", `/api/sites/${created.id}/branches/main`);
      await cloud("PUT", `/api/sites/${created.id}/branches/main/document`, { body: { document: JSON.parse(json), baseVersion: now.versionId, message: `Copy ${images.size + libraryImages.size} images from the local app` } });
    }

    // 3. Publish if asked and it was live here.
    let live = "";
    if (publish && site.liveUrl) live = ` → published at ${(await cloud("POST", `/api/sites/${created.id}/publish`, { body: {} })).url}`;
    say(`  copied ${label}${created.slug !== site.slug ? ` as ${created.slug}` : ""}: ${what}${live}`);
    results.push({ label, ok: true });
  } catch (e) {
    say(`  failed ${label}: ${e.message}`);
    results.push({ label, ok: false });
  }
}

const copied = results.filter((r) => r.ok).length;
const skipped = results.filter((r) => r.skipped).length;
const failed = results.length - copied - skipped;
say(`\n${dryRun ? "Would copy" : "Copied"} ${copied} of ${results.length} sites${skipped ? `, skipped ${skipped}` : ""}${failed ? `, ${failed} failed` : ""}.`);
if (!dryRun && copied) say(`Open ${to} to see them. Your local copies are unchanged.`);
process.exit(failed ? 1 : 0);
