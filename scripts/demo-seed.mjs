#!/usr/bin/env node
// Fill a Sitecraft workspace with a pharma demo portfolio, through the API:
// sites filed by therapy area, brand, market and audience; reviewers for
// medical, legal and regulatory sign-off; Claude branches; reviews in every
// state; scheduled releases; and library assets with job codes and rights.
//
//   SITECRAFT_URL=http://localhost:4000 SITECRAFT_TOKEN=<admin token> node scripts/demo-seed.mjs
//
// Brands and people are made up. Run it on an empty demo workspace.

const base = (process.env.SITECRAFT_URL ?? "http://localhost:4000").replace(/\/$/, "");
const admin = process.env.SITECRAFT_TOKEN ?? "";

async function call(method, path, body, token = admin, raw) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  if (raw) headers["content-type"] = raw.type;
  else if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}/api${path}`, { method, headers, body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data?.error ?? text}`);
  return data;
}

const me = await call("GET", "/me");
if (me.role !== "admin") throw new Error("Use an admin token (or the local app).");
const local = !!me.local;

// People. On the local app there's one owner, so reviewers only exist in the cloud.
const people = {};
if (!local) {
  for (const [name, role, disciplines] of [
    ["Maya Chen", "editor", []],
    ["Dr. Elena Ruiz", "editor", ["medical"]],
    ["Daniel Okafor", "editor", ["legal"]],
    ["Priya Nair", "editor", ["regulatory"]],
  ]) {
    people[name] = (await call("POST", "/tokens", { name, role, disciplines, expiresInDays: 30 })).token;
  }
  people.claude = (await call("POST", "/tokens", { name: "Claude for Maya", role: "agent", onBehalfOf: "Maya Chen", expiresInDays: 30 })).token;
}
const editor = people["Maya Chen"] ?? admin;
// On the local app, Claude edits through the MCP server's agent token; here we stand in for it.
const claude = people.claude ?? process.env.SITECRAFT_AGENT_TOKEN ?? "";

const SITES = [
  ["Calvexa US HCP", "saas", "Immunology", "US", "hcp", "US-CAL-2400123"],
  ["Calvexa US Patient", "landing", "Immunology", "US", "patient", "US-CAL-2400151"],
  ["Calvexa UK HCP", "saas", "Immunology", "GB", "hcp", "GB-CAL-2400871"],
  ["Neurivo UK Patient", "landing", "Neurology", "GB", "patient", "GB-NEU-2500204"],
  ["Neurivo DE HCP", "saas", "Neurology", "DE", "hcp", "DE-NEU-2500031"],
  ["Corporate careers", "blog", null, "GLOBAL", "corporate", null],
];

const ids = {};
for (const [name, template, therapyArea, market, audience, jobCode] of SITES) {
  const s = await call("POST", "/sites", { name, template });
  ids[name] = s.id;
  await call("PUT", `/sites/${s.id}/profile`, { therapyArea, market, audience, jobCode });
  console.log(`Created ${name}`);
}

// Brands from the first site of each, applied to their sites.
const brand = {};
for (const [b, from, members] of [
  ["Calvexa", "Calvexa US HCP", ["Calvexa US HCP", "Calvexa US Patient", "Calvexa UK HCP"]],
  ["Neurivo", "Neurivo UK Patient", ["Neurivo UK Patient", "Neurivo DE HCP"]],
]) {
  brand[b] = (await call("POST", "/brands", { name: b, fromSite: ids[from], locked: false })).id;
  for (const m of members) await call("PUT", `/sites/${ids[m]}/brand`, { brandId: brand[b] });
}

// MLR rules on the regulated sites; job codes required on US HCP.
for (const n of ["Calvexa US HCP", "Calvexa UK HCP", "Neurivo DE HCP"]) await call("PUT", `/sites/${ids[n]}/policy`, { reviewDisciplines: ["medical", "legal", "regulatory"] });
for (const n of ["Calvexa US Patient", "Neurivo UK Patient"]) await call("PUT", `/sites/${ids[n]}/policy`, { reviewDisciplines: ["medical", "legal"] });

const head = async (site, branch = "main") => (await call("GET", `/sites/${site}/branches/${encodeURIComponent(branch)}`)).document;
const edit = async (token, site, branch, text, message) => {
  const doc = await head(site, branch);
  await call("POST", `/sites/${site}/branches/${encodeURIComponent(branch)}/ops`, { ops: [{ op: "add_block", parentId: doc.pages[0].root.id, block: "text-section" }], message }, token);
  const d2 = await head(site, branch);
  const last = d2.pages[0].root.children.at(-1);
  const heading = JSON.stringify(last).match(/"id":"([^"]+)","type":"heading"/)?.[1];
  if (heading) await call("POST", `/sites/${site}/branches/${encodeURIComponent(branch)}/ops`, { ops: [{ op: "update_node", nodeId: heading, props: { text } }], message }, token);
};

// Job codes on every Calvexa US HCP page, then publish the sites that are live.
const hcp = await head(ids["Calvexa US HCP"]);
await call("POST", `/sites/${ids["Calvexa US HCP"]}/branches/main/ops`, { ops: hcp.pages.map((p, i) => ({ op: "update_page", pageId: p.id, jobCode: `US-CAL-24001${String(23 + i).padStart(2, "0")}` })), message: "Add job codes" });
await call("PUT", `/sites/${ids["Calvexa US HCP"]}/policy`, { requireJobCodes: true });
for (const n of ["Calvexa US HCP", "Calvexa US Patient", "Calvexa UK HCP", "Neurivo UK Patient", "Neurivo DE HCP"]) await call("POST", `/sites/${ids[n]}/publish`, {});

const due = (h) => new Date(Date.now() + h * 3600e3).toISOString();

// A person's change in MLR review, due today.
await call("POST", `/sites/${ids["Calvexa US HCP"]}/branches`, { name: "efficacy-update" }, editor);
await edit(editor, ids["Calvexa US HCP"], "efficacy-update", "Week 52 efficacy results", "Update efficacy claims with week 52 data");
const r1 = await call("POST", `/sites/${ids["Calvexa US HCP"]}/branches/efficacy-update/reviews`, { title: "Review updated efficacy claims", dueAt: due(6), note: "Week 52 data from the CALVEX-3 study. References in the footnotes." }, editor);
if (!local) await call("POST", `/sites/${ids["Calvexa US HCP"]}/branches/efficacy-update/approvals`, { discipline: "medical", note: "Claims match the label", signature: { name: "Dr. Elena Ruiz", token: people["Dr. Elena Ruiz"] } }, people["Dr. Elena Ruiz"]);

// Claude's work: one sent for review, one not yet.
if (claude) {
  await call("POST", `/sites/${ids["Calvexa US Patient"]}/branches`, { name: "agent/isi-copy-update" }, claude);
  await edit(claude, ids["Calvexa US Patient"], "agent/isi-copy-update", "Important safety information", "Update safety language to the new label");
  await call("POST", `/sites/${ids["Calvexa US Patient"]}/branches/agent%2Fisi-copy-update/reviews`, { title: "Claude drafted safety-language updates", dueAt: due(8) }, claude);
  await call("POST", `/sites/${ids["Neurivo DE HCP"]}/branches`, { name: "agent/de-translation" }, claude);
  await edit(claude, ids["Neurivo DE HCP"], "agent/de-translation", "Wichtige Sicherheitsinformationen", "Translate the safety section into German");
}

// A review sent back with a reason.
await call("POST", `/sites/${ids["Neurivo UK Patient"]}/branches`, { name: "support-resources" }, editor);
await edit(editor, ids["Neurivo UK Patient"], "support-resources", "Living with migraine", "Add patient support resources");
const r3 = await call("POST", `/sites/${ids["Neurivo UK Patient"]}/branches/support-resources/reviews`, { title: "New patient support resources", dueAt: due(50) }, editor);
if (!local) await call("POST", `/reviews/${r3.id}/changes`, { reason: "Add the adverse event reporting line under the support section.", discipline: "legal" }, people["Daniel Okafor"]);

// Releases.
await call("POST", `/sites/${ids["Calvexa UK HCP"]}/schedules`, { branch: "main", runAt: due(70), note: "Autumn congress update" });
await call("POST", `/sites/${ids["Calvexa US HCP"]}/schedules`, { branch: "efficacy-update", runAt: due(96), note: "Week 52 data launch" }, editor);

// Library assets with job codes, markets and rights.
// A real PNG: a soft two-colour gradient, so the library has something to show.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const { deflateSync } = await import("node:zlib");
const png = (w, h, [r1, g1, b1], [r2, g2, b2]) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x / w) * 0.6 + (y / h) * 0.4;
      const glow = Math.max(0, 1 - Math.hypot(x / w - 0.7, y / h - 0.35) * 2.2) * 60;
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = Math.min(255, r1 + (r2 - r1) * t + glow);
      raw[o + 1] = Math.min(255, g1 + (g2 - g1) * t + glow);
      raw[o + 2] = Math.min(255, b1 + (b2 - b1) * t + glow);
    }
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};
const COLORS = [
  [[30, 64, 175], [56, 189, 248]],
  [[15, 118, 110], [253, 224, 171]],
  [[91, 33, 182], [244, 114, 182]],
  [[51, 65, 85], [203, 213, 225]],
];
for (const [i, [title, code, markets, status, days, b]] of [
  ["Calvexa hero, clinic", "GLB-CAL-2600018", [], "approved", 400, "Calvexa"],
  ["Calvexa patient lifestyle", "US-CAL-2400148", ["US"], "approved", 5, "Calvexa"],
  ["Neurivo mechanism of action", "GB-NEU-2500219", ["GB", "DE"], "in_review", null, "Neurivo"],
  ["Corporate campus", "GLB-COR-2600002", [], "approved", null, null],
].entries()) {
  const a = await call("POST", `/assets?filename=${encodeURIComponent(title.toLowerCase().replace(/\W+/g, "-"))}.png&title=${encodeURIComponent(title)}`, undefined, admin, { type: "image/png", data: png(480, 300, ...COLORS[i]) });
  await call("PATCH", `/assets/${a.id}`, { alt: title, jobCode: code, markets, status, expiresAt: days ? new Date(Date.now() + days * 864e5).toISOString().slice(0, 10) : null, brandId: b ? brand[b] : null });
}

console.log(`\nDone. Open ${base} to see the demo portfolio.`);
if (!local) {
  console.log("\nSign-in tokens for the demo people (they expire in 30 days):");
  for (const [n, t] of Object.entries(people)) console.log(`  ${n.padEnd(16)} ${t}`);
}
void r1;
