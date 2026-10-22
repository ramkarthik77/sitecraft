import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, auth, EDITOR, startTestServer } from "./helpers.js";
import { clearTokenCache } from "../src/auth.js";
import { csvCell } from "../src/security.js";
import type { AppContext } from "../src/server.js";

let app: FastifyInstance;
let ctx: AppContext;
let siteA = "";
let siteB = "";

const call = async (method: string, url: string, token: string | null, payload?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: method as never, url, headers: { ...(token ? auth(token) : {}), ...headers }, payload: payload as never });
  let body: unknown = res.body;
  try {
    body = JSON.parse(res.body);
  } catch {
    /* not JSON */
  }
  return { status: res.statusCode, body: body as Record<string, unknown> & unknown[], res };
};

beforeAll(async () => {
  ({ app, ctx } = await startTestServer({ DATABASE_URL: "pglite:memory", RATE_LIMIT_PER_MINUTE: "100000" }));
  siteA = ((await call("POST", "/api/sites", EDITOR, { name: "Alpha", template: "landing" })).body as { id: string }).id;
  siteB = ((await call("POST", "/api/sites", EDITOR, { name: "Beta", template: "blank" })).body as { id: string }).id;
});
afterAll(async () => app?.close());

describe("tokens", () => {
  it("admins create tokens that expire in 90 days by default, list them and revoke them", async () => {
    expect((await call("POST", "/api/tokens", EDITOR, { name: "x", role: "editor" })).status).toBe(403);
    const made = await call("POST", "/api/tokens", ADMIN, { name: "Priya", role: "editor" });
    expect(made.status).toBe(200);
    const t = made.body as { id: string; token: string; expiresAt: string };
    const days = (Date.parse(t.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
    expect((await call("GET", "/api/me", t.token)).body).toMatchObject({ name: "Priya", role: "editor" });

    const list = (await call("GET", "/api/tokens", ADMIN)).body as { id: string; name: string; lastUsedAt: string | null }[];
    const row = list.find((x) => x.id === t.id)!;
    expect(row.lastUsedAt).not.toBeNull();
    expect(JSON.stringify(list)).not.toContain(t.token); // only hashes are stored

    expect((await call("DELETE", `/api/tokens/${t.id}`, ADMIN)).status).toBe(204);
    const after = await call("GET", "/api/me", t.token);
    expect(after.status).toBe(401);
    expect(after.body.error).toContain("revoked");
    expect((await call("DELETE", `/api/tokens/${t.id}`, ADMIN)).status).toBe(404);
  });

  it("rejects expired tokens and bad expiry values", async () => {
    const t = (await call("POST", "/api/tokens", ADMIN, { name: "Old", role: "editor", expiresInDays: 1 })).body as { id: string; token: string };
    expect((await call("GET", "/api/me", t.token)).status).toBe(200);
    await ctx.db.query("UPDATE api_tokens SET expires_at = now() - interval '1 minute' WHERE id = $1", [t.id]);
    clearTokenCache();
    const res = await call("GET", "/api/me", t.token);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("expired");
    expect((await call("POST", "/api/tokens", ADMIN, { name: "Bad", role: "editor", expiresInDays: 0 })).status).toBe(400);
    expect((await call("POST", "/api/tokens", ADMIN, { name: "Forever", role: "agent", expiresInDays: null })).body).toMatchObject({ expiresAt: null });
  });

  it("tokens limited to a site can't see or touch other sites", async () => {
    const t = (await call("POST", "/api/tokens", ADMIN, { name: "Alpha's Claude", role: "agent", sites: ["alpha"] })).body as { token: string; siteIds: string[] };
    expect(t.siteIds).toEqual([siteA]);
    const list = (await call("GET", "/api/sites", t.token)).body as { id: string }[];
    expect(list.map((s) => s.id)).toEqual([siteA]);
    expect((await call("GET", `/api/sites/${siteA}/branches/main`, t.token)).status).toBe(200);
    expect((await call("GET", `/api/sites/${siteB}/branches/main`, t.token)).status).toBe(403);
    expect((await call("GET", `/api/sites/beta/branches/main`, t.token)).status).toBe(403);
    expect((await call("POST", "/api/sites", t.token, { name: "Sneaky" })).status).toBe(403);
    expect((await call("POST", "/api/tokens", ADMIN, { name: "Scoped admin", role: "admin", sites: ["alpha"] })).status).toBe(400);
  });
});

describe("live updates", () => {
  it("needs a short-lived ticket, not the token in the URL", async () => {
    expect((await call("GET", `/api/sites/${siteA}/events?token=${EDITOR}`, null)).status).toBe(401);
    expect((await call("GET", `/api/sites/${siteA}/events?ticket=forged.sig`, null)).status).toBe(401);
    const { ticket } = (await call("POST", `/api/sites/${siteA}/events/ticket`, EDITOR, {})).body as unknown as { ticket: string };
    // A ticket only opens the stream of the site it was issued for.
    expect((await call("GET", `/api/sites/${siteB}/events?ticket=${encodeURIComponent(ticket)}`, null)).status).toBe(401);
    expect((await call("GET", `/api/sites/${siteA}/branches/main?ticket=${encodeURIComponent(ticket)}`, null)).status).toBe(401);
  });
});

describe("headers", () => {
  it("published pages and previews get a strict Content-Security-Policy", async () => {
    await call("POST", `/api/sites/${siteA}/publish`, EDITOR, {});
    const page = await app.inject({ method: "GET", url: "/s/alpha/" });
    const csp = String(page.headers["content-security-policy"]);
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("'unsafe-inline' 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(page.headers["x-content-type-options"]).toBe("nosniff");
    // The only inline script on the page is the one the hash allows.
    const scripts = [...page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    const { createHash } = await import("node:crypto");
    expect(csp).toContain(`'sha256-${createHash("sha256").update(scripts[0]![1]!).digest("base64")}'`);
  });

  it("the API isn't cached or framed", async () => {
    const r = await call("GET", "/api/me", EDITOR);
    expect(r.res.headers["cache-control"]).toBe("no-store");
    expect(r.res.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("forms", () => {
  const send = (data: Record<string, string>) =>
    app.inject({ method: "POST", url: `/forms/${siteA}/contact`, headers: { "content-type": "application/json" }, payload: data });

  it("drops bot submissions quietly, stores real ones without the trap field", async () => {
    expect((await send({ email: "bot@spam.test", _hp: "gotcha" })).statusCode).toBe(200);
    expect((await send({ email: "jane@example.com", note: "=HYPERLINK(\"x\")", _hp: "" })).statusCode).toBe(200);
    const subs = (await call("GET", `/api/sites/${siteA}/forms`, EDITOR)).body as { data: Record<string, string> }[];
    expect(subs).toHaveLength(1);
    expect(subs[0]!.data).toEqual({ email: "jane@example.com", note: '=HYPERLINK("x")' });
  });

  it("exports CSV safely and deletes on request", async () => {
    await send({ email: "sam@example.com" });
    const csv = await app.inject({ method: "GET", url: `/api/sites/${siteA}/forms.csv`, headers: auth(EDITOR) });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body.split("\r\n")[0]).toBe("submitted_at,form,email,note");
    expect(csv.body).toContain(`"'=HYPERLINK(""x"")"`); // formulas don't run in spreadsheets
    const del = await call("DELETE", `/api/sites/${siteA}/forms?containing=jane%40example.com`, EDITOR);
    expect(del.body).toEqual({ deleted: 1 });
    expect(((await call("GET", `/api/sites/${siteA}/forms`, EDITOR)).body as unknown[]).length).toBe(1);
    expect((await call("DELETE", `/api/sites/${siteA}/forms?before=someday`, EDITOR)).status).toBe(400);
  });

  it("the audit log exports as CSV for admins", async () => {
    expect((await app.inject({ method: "GET", url: "/api/audit.csv", headers: auth(EDITOR) })).statusCode).toBe(403);
    const csv = await app.inject({ method: "GET", url: "/api/audit.csv", headers: auth(ADMIN) });
    expect(csv.body).toContain("token.revoke");
    expect(csv.body).toContain("forms.delete");
  });
});

describe("csv", () => {
  it("escapes formulas, quotes and new lines", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
  });
});

describe("rate limits", () => {
  it("slows down repeated failed sign-ins", async () => {
    const { app: limited } = await startTestServer({ DATABASE_URL: "pglite:memory" });
    let last = 0;
    for (let i = 0; i < 32; i++) last = (await limited.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer wrong", "x-forwarded-for": "203.0.113.9" } })).statusCode;
    expect(last).toBe(429);
    // Someone else isn't affected.
    expect((await limited.inject({ method: "GET", url: "/api/me", headers: { ...auth(EDITOR), "x-forwarded-for": "203.0.113.10" } })).statusCode).toBe(200);
    await limited.close();
  });
});
