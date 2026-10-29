import { chromium, type Browser } from "playwright-core";
import { safeFetchBytes, type SafeFetchOptions } from "./safefetch.js";

/**
 * Browser capture for authorized public websites.
 *
 * IMPORTANT: The browser has NO direct network access through this capture.
 * Every GET is fulfilled from safeFetchBytes, which pins DNS and checks every
 * redirect. POST/PUT, WebSocket, service workers and downloads are blocked.
 * Missing Chromium is a documented static-parser fallback, never an unsafe fetch.
 */
export interface RenderedStyle {
  selector: string;
  tag: string;
  role: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  computed: {
    display: string; flexDirection: string; gridTemplateColumns: string;
    gap: string; backgroundColor: string; color: string; fontFamily: string;
    fontSize: string; fontWeight: string; textAlign: string; objectFit: string;
    padding: string; borderRadius: string;
  };
}
export interface RenderedCapture {
  url: string;
  html: string;
  title: string;
  styles: RenderedStyle[];
  screenshot: Buffer;
  warnings: string[];
}
export interface RenderedCaptureOptions {
  fetch?: SafeFetchOptions;
  viewport?: { width: number; height: number };
  chromiumPath?: string;
}

/** One browser per import job, with a fresh isolated context per source page. */
export const launchImportBrowser = () => chromium.launch({
  headless: true,
  executablePath: process.env.SITECRAFT_IMPORT_CHROMIUM_PATH || process.env.PW_CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"],
  timeout: 12_000,
});

export async function captureRenderedPage(
  raw: string,
  options: RenderedCaptureOptions = {},
  existingBrowser?: Browser,
): Promise<RenderedCapture> {
  const warnings: string[] = [];
  let browser: Browser | undefined = existingBrowser;
  const owned = !existingBrowser;
  try {
    browser ??= await chromium.launch({
      headless: true,
      executablePath: options.chromiumPath || process.env.SITECRAFT_IMPORT_CHROMIUM_PATH || process.env.PW_CHROMIUM_PATH || undefined,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"],
      timeout: 12_000,
    });
    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      serviceWorkers: "block",
      acceptDownloads: false,
      javaScriptEnabled: true,
      permissions: [],
      bypassCSP: false,
      ignoreHTTPSErrors: false,
    });
    try {
      let count = 0;
      let bytes = 0;
      await context.route("**/*", async (route) => {
        const req = route.request();
        if (req.method() !== "GET" || req.resourceType() === "websocket" ||
            /\/(?:beacon|collect|analytics|tracking|pixel)(?:\/|\?|$)/i.test(req.url()) ||
            count >= 100 || bytes >= 25_000_000) {
          await route.abort("blockedbyclient").catch(() => undefined);
          return;
        }
        count++;
        try {
          const r = await safeFetchBytes(req.url(), {
            ...options.fetch,
            maxBytes: req.resourceType() === "document" ? 3_000_000 : 4_000_000,
            timeoutMs: 7_000,
          });
          bytes += r.body.length;
          // Browser resource types are delivered exactly as sniffed upstream;
          // scripts cannot escape the proxy into private addresses.
          await route.fulfill({
            status: r.status,
            contentType: r.contentType || "application/octet-stream",
            body: r.body,
          });
        } catch {
          await route.abort("blockedbyclient").catch(() => undefined);
        }
      });
      const page = await context.newPage();
      page.on("dialog", (d) => void d.dismiss());
      page.on("popup", (p) => void p.close());
      const response = await page.goto(raw, { waitUntil: "domcontentloaded", timeout: 18_000 });
      if (!response || !response.ok()) throw new Error("The rendered page did not load.");
      // Give client-side hydration a short, bounded window, without allowing
      // continuous trackers to hold the import open forever.
      await page.waitForTimeout(700);
      // Annotate computed layout structure before serialising the DOM. Source
      // classes often say only "row", "col" or hashed CSS-module names.
      // These bounded hints are consumed by the safe static node converter.
      await page.evaluate(() => {
        const main = document.querySelector("main, [role=main]") ?? document.body;
        for (const el of Array.from(main.querySelectorAll("div,section,article,ul")).slice(0, 550)) {
          const css = getComputedStyle(el);
          const children = Array.from(el.children).filter((c) => {
            const s = getComputedStyle(c);
            const r = c.getBoundingClientRect();
            return s.display !== "none" && s.visibility !== "hidden" && r.width > 12 && r.height > 12;
          });
          if (children.length < 2 || children.length > 6) continue;
          if (css.display === "grid" && /\d+px\s+\d+px/.test(css.gridTemplateColumns) && children.length >= 2) {
            el.setAttribute("data-sitecraft-layout", "grid");
          } else if ((css.display === "flex" || css.display === "inline-flex") && css.flexDirection === "row" && children.length === 2 &&
            children.some((c) => !!c.querySelector("img,video")) && children.some((c) => (c.textContent ?? "").trim().length > 30)) {
            el.setAttribute("data-sitecraft-layout", "split");
          }
        }
      });
      const html = await page.content();
      const styles = await page.evaluate(() => {
        const root = document.querySelector("main, [role=main]") ?? document.body;
        const nodes = Array.from(root.querySelectorAll("section,article,header,footer,[class*=hero],[class*=grid],[class*=card],h1,h2,h3,img"))
          .filter((x) => {
            const r = x.getBoundingClientRect();
            const css = getComputedStyle(x);
            return r.width >= 5 && r.height >= 5 && css.display !== "none" && css.visibility !== "hidden";
          })
          .slice(0, 90);
        return nodes.map((el, i) => {
          const css = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            selector: `${el.tagName.toLowerCase()}:nth-capture(${i + 1})`,
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") ?? "",
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
            rect: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
            computed: {
              display: css.display, flexDirection: css.flexDirection,
              gridTemplateColumns: css.gridTemplateColumns, gap: css.gap,
              backgroundColor: css.backgroundColor, color: css.color,
              fontFamily: css.fontFamily, fontSize: css.fontSize,
              fontWeight: css.fontWeight, textAlign: css.textAlign,
              objectFit: css.objectFit, padding: css.padding, borderRadius: css.borderRadius,
            },
          };
        });
      });
      const screenshot = await page.screenshot({ type: "png", fullPage: false, animations: "disabled", timeout: 8_000 });
      if (count >= 100 || bytes >= 25_000_000) warnings.push("Some page resources were omitted by the capture safety limits.");
      return { url: page.url(), html, title: await page.title(), styles, screenshot, warnings };
    } finally {
      await context.close();
    }
  } finally {
    if (owned) await browser?.close();
  }
}
