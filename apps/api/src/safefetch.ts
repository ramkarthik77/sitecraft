import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { HttpError } from "./errors.js";

/**
 * Fetch a public web page for importing, without letting the address reach
 * anything inside the network: only http(s) on the default ports, every
 * address the name resolves to must be public, each redirect is checked the
 * same way, and the connection goes to the address that was checked (so a
 * DNS answer can't change in between). Sizes and times are capped.
 */

export interface SafeFetchOptions {
  /** Allow private and loopback addresses (tests, or the local app on your own computer), always or for some addresses. */
  allowPrivate?: boolean | ((url: URL) => boolean);
  maxBytes?: number;
  timeoutMs?: number;
  accept?: RegExp;
}

export interface Fetched {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

/** True for addresses that aren't on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast and reserved
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff") || x.startsWith("64:ff9b:");
  }
  return true;
}

const BLOCKED_HOSTS = /^(localhost|metadata\.google\.internal|metadata)$|\.(local|internal|localhost)$/i;

/** Check an address and pick the IP to connect to. */
export async function checkUrl(raw: string, opts: SafeFetchOptions = {}): Promise<{ url: URL; ip: string; family: 4 | 6 }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "That isn't a web address. It should look like https://www.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "Only http and https addresses can be imported.");
  if (url.username || url.password) throw new HttpError(400, "Leave the user name and password out of the address.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const allow = typeof opts.allowPrivate === "function" ? opts.allowPrivate(url) : !!opts.allowPrivate;
  if (!allow && BLOCKED_HOSTS.test(host)) throw new HttpError(400, "That address is inside a private network, so it can't be imported.");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) as 4 | 6 }] : await dnsLookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, `Couldn't find ${host}. Check the address.`);
  if (!allow && addrs.some((a) => isPrivateAddress(a.address))) throw new HttpError(400, "That address is inside a private network, so it can't be imported.");
  if (url.port && !["80", "443"].includes(url.port) && !allow) throw new HttpError(400, "Only addresses on the standard web ports can be imported.");
  // Prefer IPv4: many servers (and CI runners) listen there even when the name also has an IPv6 address.
  const pick = addrs.find((a) => a.family === 4) ?? addrs[0]!;
  return { url, ip: pick.address, family: pick.family as 4 | 6 };
}

function getOnce(url: URL, ip: string, family: 4 | 6, opts: Required<Pick<SafeFetchOptions, "maxBytes" | "timeoutMs">>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        // Connect to the address that was checked, whatever DNS says now.
        lookup: (_h, o, cb) => (typeof o === "object" && (o as { all?: boolean }).all ? (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: ip, family }]) : cb(null, ip, family)),
        headers: { "user-agent": "Sitecraft importer (+https://github.com/ramkarthik77/sitecraft)", accept: "text/html,application/xhtml+xml,text/css;q=0.9,*/*;q=0.1", "accept-encoding": "identity" },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > opts.maxBytes) {
            req.destroy();
            reject(new HttpError(400, "That page is too large to import."));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new HttpError(400, "The site took too long to answer.")));
    req.on("error", (e) => reject(e instanceof HttpError ? e : new HttpError(400, `Couldn't reach the site: ${(e as Error).message}`)));
    req.end();
  });
}

export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<Fetched> {
  const o = { maxBytes: opts.maxBytes ?? 3_000_000, timeoutMs: opts.timeoutMs ?? 10_000 };
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    const { url, ip, family } = await checkUrl(current, opts);
    const res = await getOnce(url, ip, family, o);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      current = new URL(res.headers.location, url).toString();
      continue;
    }
    if (res.status >= 400) throw new HttpError(400, `The site answered ${res.status} for ${url.pathname}.`);
    const contentType = String(res.headers["content-type"] ?? "");
    if (opts.accept && !opts.accept.test(contentType)) throw new HttpError(400, `That address isn't a web page (${contentType || "unknown type"}).`);
    return { url: url.toString(), status: res.status, contentType, body: res.body.toString("utf8") };
  }
  throw new HttpError(400, "That address redirects too many times.");
}
