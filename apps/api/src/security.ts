import { createHash } from "node:crypto";
import { RUNTIME_SCRIPT } from "@sitecraft/renderer";
import type { Config } from "./config.js";

/**
 * Security headers and limits shared by the editor, the API and published
 * sites. Content-Security-Policy is the second line of defence behind the
 * document validation: even if something unsafe got into a page, the browser
 * wouldn't run it.
 */

/** The published-site runtime is the only inline script Sitecraft emits; allow exactly it. */
export const RUNTIME_HASH = `'sha256-${createHash("sha256").update(RUNTIME_SCRIPT).digest("base64")}'`;
const TURNSTILE = "https://challenges.cloudflare.com";
const FONT_CSS = "https://fonts.googleapis.com";
const FONT_FILES = "https://fonts.gstatic.com";

const origin = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

const common = (cfg: Config): Record<string, string> => ({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  ...(cfg.publicUrl.startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
});

/** Headers for published pages and previews. */
export function siteHeaders(cfg: Config): Record<string, string> {
  const api = origin(cfg.publicUrl);
  const csp = [
    "default-src 'self'",
    `script-src ${RUNTIME_HASH} ${TURNSTILE}`,
    `style-src 'unsafe-inline' ${FONT_CSS}`,
    `font-src ${FONT_FILES} data:`,
    "img-src * data: blob:",
    "media-src * data: blob:",
    `frame-src https: ${TURNSTILE}`,
    `connect-src 'self' ${api}`,
    `form-action 'self' ${api}`,
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
  return { ...common(cfg), "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": csp };
}

/** Headers for the editor app. Its canvas loads the bridge script from /canvas-bridge.js. */
export function editorHeaders(cfg: Config): Record<string, string> {
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${RUNTIME_HASH}`,
    `style-src 'self' 'unsafe-inline' ${FONT_CSS}`,
    `font-src 'self' ${FONT_FILES} data:`,
    "img-src * data: blob:",
    "media-src * data: blob:",
    "frame-src 'self' https:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
  return { ...common(cfg), "X-Frame-Options": "DENY", "Content-Security-Policy": csp };
}

export function apiHeaders(cfg: Config): Record<string, string> {
  return { ...common(cfg), "Cache-Control": "no-store", "X-Frame-Options": "DENY" };
}

/** Sliding-window counters, per server. Cloudflare's rate limiting rules add a shared limit in front. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}

  /** Record a hit; true when the key is over its limit. */
  hit(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 50_000) this.sweep(now);
    return list.length > this.max;
  }

  /** True when the key is over its limit, without recording a hit. */
  over(key: string, now = Date.now()): boolean {
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length > this.max;
  }

  private sweep(now: number) {
    for (const [k, list] of this.hits) if (!list.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

/** Check a Cloudflare Turnstile response. */
export async function verifyTurnstile(secret: string, response: string | undefined, ip: string): Promise<boolean> {
  if (!response) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response, remoteip: ip }),
    });
    const data = (await res.json()) as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

/** One CSV cell. Leading = + - @ are escaped so spreadsheets don't run them as formulas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}
