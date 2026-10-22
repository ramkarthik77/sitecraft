import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { HttpError } from "./errors.js";

export type Role = "admin" | "editor" | "agent";

export interface Actor {
  name: string;
  role: Role;
  /** True for the owner of a local app, signed in by being on this computer. */
  local?: boolean;
  /** When set, the token may only touch these sites. */
  siteIds?: string[];
  /** The token's id, for audit and revocation. */
  tokenId?: string;
}

export const LOCAL_OWNER: Actor = { name: "You", role: "admin", local: true };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A request counts as coming from the owner of a local app only when it was
 * sent to a loopback hostname (which blocks DNS-rebinding tricks) and, if the
 * browser sent an Origin, that origin is this computer too (which blocks other
 * websites from using your local Sitecraft).
 */
export function isLocalRequest(req: FastifyRequest): boolean {
  const host = hostnameOf(req.headers.host);
  if (!host || !LOOPBACK.has(host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  const o = hostnameOf(origin);
  return !!o && LOOPBACK.has(o);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken(): string {
  return "sc_" + randomBytes(24).toString("base64url");
}

export interface TokenOptions {
  /** Days until the token stops working; omit for no expiry. */
  expiresInDays?: number;
  /** Limit the token to these site ids. */
  siteIds?: string[];
  createdBy?: string;
}

export async function createToken(db: Db, name: string, role: Role, token = generateToken(), opts: TokenOptions = {}): Promise<{ token: string; id: string; expiresAt: string | null }> {
  const expires = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString() : null;
  const { rows } = await db.query<{ id: string; expires_at: string | null }>(
    `INSERT INTO api_tokens (token_hash, name, role, expires_at, site_ids, created_by) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (token_hash) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, revoked_at = NULL
     RETURNING id, expires_at`,
    [hashToken(token), name, role, expires, opts.siteIds?.length ? opts.siteIds : null, opts.createdBy ?? null],
  );
  const exp = rows[0]?.expires_at;
  return { token, id: rows[0]!.id, expiresAt: exp ? new Date(exp).toISOString() : null };
}

const cache = new Map<string, { actor: Actor; at: number }>();
const CACHE_MS = 10_000;

/** Forget cached sign-ins, so a revoked token stops working at once on this server. */
export function clearTokenCache() {
  cache.clear();
}

function extractToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

export async function authenticate(db: Db, req: FastifyRequest, opts: { local?: boolean } = {}): Promise<Actor> {
  const token = extractToken(req);
  if (!token && opts.local) {
    if (isLocalRequest(req)) return LOCAL_OWNER;
    throw new HttpError(403, "This Sitecraft only accepts requests from this computer.");
  }
  if (!token) throw new HttpError(401, "Missing API token. Send Authorization: Bearer <token>.");
  return actorForToken(db, token);
}

export async function actorForToken(db: Db, token: string): Promise<Actor> {
  const key = hashToken(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.actor;
  const { rows } = await db.query<{ id: string; name: string; role: Role; site_ids: string[] | null; expires_at: string | null; revoked_at: string | null }>(
    "UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING id, name, role, site_ids, expires_at, revoked_at",
    [key],
  );
  const row = rows[0];
  if (!row) throw new HttpError(401, "Invalid API token.");
  if (row.revoked_at) throw new HttpError(401, "This token was revoked. Ask an admin for a new one.");
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) throw new HttpError(401, "This token has expired. Ask an admin for a new one.");
  const actor: Actor = { name: row.name, role: row.role, tokenId: row.id };
  if (row.site_ids?.length) actor.siteIds = parseUuidArray(row.site_ids);
  cache.set(key, { actor, at: Date.now() });
  return actor;
}

/** node-postgres returns uuid[] as an array; PGlite may return the text form. */
function parseUuidArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return String(v).replace(/^{|}$/g, "").split(",").filter(Boolean);
}

/** Can this actor touch this site? */
export function canAccessSite(actor: Actor, siteId: string): boolean {
  return !actor.siteIds || actor.siteIds.includes(siteId);
}

/**
 * Short-lived tickets for the live-updates stream. EventSource can't send an
 * Authorization header, and a long-lived token in a URL ends up in logs, so
 * the editor trades its token for a ticket that works for one site for a minute.
 */
export function signTicket(secret: string, siteId: string, actor: Actor, ttlSeconds = 60): string {
  const payload = Buffer.from(JSON.stringify({ s: siteId, n: actor.name, r: actor.role, e: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", secret).update(`ticket:${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyTicket(secret: string, siteId: string, ticket: string | undefined): Actor | null {
  if (!ticket) return null;
  const [payload, sig] = ticket.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(`ticket:${payload}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as { s: string; n: string; r: Role; e: number };
    if (t.s !== siteId || t.e < Date.now() / 1000) return null;
    return { name: t.n, role: t.r };
  } catch {
    return null;
  }
}

export function requireRole(actor: Actor, ...roles: Role[]): void {
  if (!roles.includes(actor.role)) throw new HttpError(403, `This action needs one of these roles: ${roles.join(", ")}.`);
}

/** Signed, expiring preview links that can be opened without a token. */
export function signPreview(secret: string, siteId: string, branch: string, ttlSeconds = 7 * 24 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", secret).update(`${siteId}:${branch}:${exp}`).digest("base64url");
  return `${exp}.${sig}`;
}

export function verifyPreview(secret: string, siteId: string, branch: string, key: string | undefined): boolean {
  if (!key) return false;
  const [expStr, sig] = key.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < Date.now() / 1000) return false;
  const expected = createHmac("sha256", secret).update(`${siteId}:${branch}:${exp}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
