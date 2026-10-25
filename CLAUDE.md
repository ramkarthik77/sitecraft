# Working on Sitecraft

Guides: `docs/LOCAL_SETUP.md` (run it), `docs/ARCHITECTURE.md` (how it fits together), `docs/CLAUDE_CODE.md` (the MCP tools), `docs/TROUBLESHOOTING.md`, `docs/EXTENDING.md` (new sections, elements and ops), `docs/GOVERNANCE.md` (MLR reviews, job codes, publish rules, audit).

- Monorepo with pnpm. Build order matters: `packages/schema` → `packages/renderer` → apps. `pnpm build` handles it.
- Every document change goes through the operations in `packages/schema/src/ops.ts`. Add a new kind of edit there (with validation and a test) rather than mutating documents in the API, editor or MCP server.
- The renderer is shared by the canvas, previews and publishing; keep it free of Node or DOM APIs.
- Anything rendered into HTML or CSS must pass the checks in `packages/schema/src/validate.ts` (safe hrefs, image sources, CSS values, allowed style keys).
- Agent guardrails live in `apps/api/src/routes/api.ts` (`assertCanWrite`, `assertCanShip`). Don't weaken them in the MCP server.
- Tests: `pnpm test` needs Postgres at `TEST_DATABASE_URL` (default `postgres://sitecraft:sitecraft@localhost:5432/sitecraft_test`). `pnpm test:e2e` needs Postgres and Chromium.
- UI copy is sentence case, plain and specific. Buttons say what they do ("Merge into main", "Publish").
