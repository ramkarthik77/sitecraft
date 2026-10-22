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

export async function createToken(db: Db, name: string, role: Role, token = generateToken()): Promise<string> {
  await db.query(
    "INSERT INTO api_tokens (token_hash, name, role) VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role",
    [hashToken(token), name, role],
  );
  return token;
}

const cache = new Map<string, { actor: Actor; at: number }>();

function extractToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  // EventSource can't send headers, so the event stream accepts ?token=.
  const q = (req.query as Record<string, unknown> | undefined)?.token;
  if (typeof q === "string" && req.url.includes("/events")) return q;
  return null;
}

export async function authenticate(db: Db, req: FastifyRequest, opts: { local?: boolean } = {}): Promise<Actor> {
  const token = extractToken(req);
  if (!token && opts.local) {
    if (isLocalRequest(req)) return LOCAL_OWNER;
    throw new HttpError(403, "This Sitecraft only accepts requests from this computer.");
  }
  if (!token) throw new HttpError(401, "Missing API token. Send Authorization: Bearer <token>.");
  const key = hashToken(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.actor;
  const { rows } = await db.query<{ name: string; role: Role }>(
    "UPDATE api_tokens SET last_used_at = now() WHERE token_hash = $1 RETURNING name, role",
    [key],
  );
  if (!rows[0]) throw new HttpError(401, "Invalid API token.");
  const actor = { name: rows[0].name, role: rows[0].role };
  cache.set(key, { actor, at: Date.now() });
  return actor;
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
