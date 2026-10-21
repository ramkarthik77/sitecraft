#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SitecraftClient } from "./client.js";
import { createSitecraftServer } from "./tools.js";

const API_URL = process.env.SITECRAFT_API_URL ?? "http://localhost:4000";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4 * 1024 * 1024) throw new Error("Request too large");
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
}

/**
 * Remote mode: Claude Code connects over Streamable HTTP and passes the
 * person's own Sitecraft token as a Bearer header, so every edit is attributed
 * to them and limited by their role. Stateless: one server per request.
 */
export function startHttp(port: number, apiUrl = API_URL) {
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });
    if (url.pathname !== "/mcp") return send(res, 404, { error: "Not found" });
    if (req.method !== "POST") return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
    const auth = req.headers.authorization ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="sitecraft"');
      return send(res, 401, { jsonrpc: "2.0", error: { code: -32001, message: "Send Authorization: Bearer <your Sitecraft token>" }, id: null });
    }
    try {
      const body = await readJson(req);
      const server = createSitecraftServer(new SitecraftClient(apiUrl, token));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) send(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: (e as Error).message }, id: null });
    }
  });
  return new Promise<typeof http>((resolve) => http.listen(port, () => resolve(http)));
}

async function startStdio() {
  const token = process.env.SITECRAFT_TOKEN;
  if (!token) {
    console.error("Set SITECRAFT_TOKEN to your Sitecraft API token.");
    process.exit(1);
  }
  const server = createSitecraftServer(new SitecraftClient(API_URL, token));
  await server.connect(new StdioServerTransport());
}

const isMain = (() => {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) {
  if (process.argv.includes("--http")) {
    const port = Number(process.env.PORT ?? 4100);
    await startHttp(port);
    console.error(`Sitecraft MCP server on http://localhost:${port}/mcp (API ${API_URL})`);
  } else {
    await startStdio();
  }
}
