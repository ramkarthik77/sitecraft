# syntax=docker/dockerfile:1.7
# One image, two targets:
#   app — API, published-site hosting and the editor (port 4000)
#   mcp — MCP server Claude Code connects to (port 4100)

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/schema/package.json packages/schema/
COPY packages/renderer/package.json packages/renderer/
COPY apps/api/package.json apps/api/
COPY apps/mcp/package.json apps/mcp/
COPY apps/editor/package.json apps/editor/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r run build

FROM node:22-alpine AS base
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S sitecraft && adduser -S sitecraft -G sitecraft
COPY --from=build --chown=sitecraft:sitecraft /app /app
USER sitecraft

FROM base AS mcp
ENV PORT=4100
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4100/healthz || exit 1
CMD ["node", "apps/mcp/dist/main.js", "--http"]

FROM base AS app
ENV PORT=4000 EDITOR_DIST=/app/apps/editor/dist
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/healthz || exit 1
CMD ["node", "apps/api/dist/main.js"]
