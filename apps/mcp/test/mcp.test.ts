import type { FastifyInstance } from "fastify";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT, EDITOR, resetDb, startTestServer } from "../../api/test/helpers.js";
import { startHttp } from "../src/main.js";

let api: FastifyInstance;
let mcpHttp: Server;
let client: Client;
const API_PORT = 4911;
const MCP_PORT = 4912;

const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]!.text);

beforeAll(async () => {
  await resetDb();
  ({ app: api } = await startTestServer({ PUBLIC_URL: `http://localhost:${API_PORT}`, EDITOR_URL: "http://localhost:5173" }));
  await api.listen({ port: API_PORT, host: "127.0.0.1" });
  mcpHttp = await startHttp(MCP_PORT, `http://127.0.0.1:${API_PORT}`);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_PORT}/mcp`), { requestInit: { headers: { authorization: `Bearer ${AGENT}` } } }),
  );
});

afterAll(async () => {
  await client?.close();
  mcpHttp?.close();
  await api?.close();
});

describe("MCP server for Claude Code", () => {
  it("rejects calls without a token", async () => {
    const res = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("lists its tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["get_site", "create_branch", "edit_site", "add_section", "update_text", "set_theme", "request_review", "publish_site"]));
  });

  it("runs the full agent workflow: create, branch, edit, preview, review", async () => {
    expect(text(await client.callTool({ name: "create_site", arguments: { name: "Orbit Labs", template: "landing" } }))).toContain("slug orbit-labs");

    const outline = text(await client.callTool({ name: "get_site", arguments: { site: "orbit-labs" } }));
    expect(outline).toContain('section "Hero"');

    // Agents are steered to a branch.
    const blocked = await client.callTool({ name: "set_theme", arguments: { site: "orbit-labs", branch: "main", colors: { primary: "#0ea5e9" } } });
    expect(blocked.isError).toBe(true);
    expect(text(blocked)).toMatch(/branch/);

    expect(text(await client.callTool({ name: "create_branch", arguments: { site: "orbit-labs", name: "agent/launch" } }))).toContain("Preview: http://localhost:4911/preview/");

    await client.callTool({ name: "set_theme", arguments: { site: "orbit-labs", branch: "agent/launch", colors: { primary: "#0ea5e9" } } });
    const added = text(
      await client.callTool({
        name: "add_section",
        arguments: { site: "orbit-labs", branch: "agent/launch", block: "pricing", index: 3, content: { headline: "Plans for every orbit" } },
      }),
    );
    expect(added).toContain("Created ids: n_");

    // Find the hero heading id from the outline and edit it.
    const branchOutline = text(await client.callTool({ name: "get_site", arguments: { site: "orbit-labs", branch: "agent/launch" } }));
    const headingId = /heading \((n_[a-z0-9]+)\) — Build beautiful sites/.exec(branchOutline)![1]!;
    await client.callTool({ name: "update_text", arguments: { site: "orbit-labs", branch: "agent/launch", nodeId: headingId, text: "Launch faster with Orbit" } });
    await client.callTool({ name: "update_style", arguments: { site: "orbit-labs", branch: "agent/launch", nodeId: headingId, breakpoint: "mobile", style: { fontSize: "34px" } } });

    const edited = await client.callTool({
      name: "edit_site",
      arguments: {
        site: "orbit-labs",
        branch: "agent/launch",
        operations: [{ op: "add_page", path: "/about", title: "About Orbit", blocks: ["navbar", "text-section", "footer"] }],
        message: "Add about page",
      },
    });
    expect(edited.isError).toBeFalsy();

    const badEdit = await client.callTool({ name: "edit_site", arguments: { site: "orbit-labs", branch: "agent/launch", operations: [{ op: "remove_node", nodeId: "nope" }] } });
    expect(badEdit.isError).toBe(true);

    const diff = text(await client.callTool({ name: "get_diff", arguments: { site: "orbit-labs", branch: "agent/launch" } }));
    expect(diff).toContain("+ page /about");
    expect(diff).toContain("~ theme");

    // The preview renders the agent's work.
    const link = /Preview: (\S+)/.exec(text(await client.callTool({ name: "get_preview_url", arguments: { site: "orbit-labs", branch: "agent/launch" } })))![1]!;
    const html = await (await fetch(link.replace("localhost", "127.0.0.1"))).text();
    expect(html).toContain("Launch faster with Orbit");
    expect(html).toContain("Plans for every orbit");
    expect(html).toContain("--color-primary:#0ea5e9");

    // Agents can't publish; they hand off for review.
    const pub = await client.callTool({ name: "publish_site", arguments: { site: "orbit-labs" } });
    expect(pub.isError).toBe(true);
    const review = text(await client.callTool({ name: "request_review", arguments: { site: "orbit-labs", branch: "agent/launch", summary: "Rebranded and added pricing and about." } }));
    expect(review).toContain("Review and merge: http://localhost:5173/sites/");
  });

  it("a person merges and publishes the agent's branch", async () => {
    const h = { authorization: `Bearer ${EDITOR}`, "content-type": "application/json" };
    const base = `http://127.0.0.1:${API_PORT}/api/sites/orbit-labs`;
    expect((await fetch(`${base}/branches/agent%2Flaunch/merge`, { method: "POST", headers: h, body: "{}" })).status).toBe(200);
    const pub = await (await fetch(`${base}/publish`, { method: "POST", headers: h, body: "{}" })).json();
    expect(pub.files).toContain("about/index.html");
    const live = await (await fetch(`http://127.0.0.1:${API_PORT}/s/orbit-labs/`)).text();
    expect(live).toContain("Launch faster with Orbit");
  });
});
