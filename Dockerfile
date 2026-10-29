# syntax=docker/dockerfile:1.7
# Targets:
#   app — API, published-site hosting and the editor (port 4000)
#   mcp — MCP server Claude Code connects to (port 4100)
#   combined (default) — either one, picked by ROLE=app or ROLE=mcp

FROM node:24-alpine AS build
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

FROM node:24-alpine AS base
# Playwright Core uses the distribution Chromium binary for website import.
# The browser runs behind the safeFetch proxy; no direct network access.
RUN apk add --no-cache chromium nss freetype harfbuzz font-noto ttf-freefont
ENV NODE_ENV=production SITECRAFT_IMPORT_CHROMIUM_PATH=/usr/bin/chromium
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

# Default target: one image that runs either service, chosen by ROLE
# (used by Cloudflare Containers, which builds the last stage).
FROM base AS combined
ENV EDITOR_DIST=/app/apps/editor/dist
EXPOSE 4000 4100
CMD ["sh", "-c", "if [ \"$ROLE\" = mcp ]; then exec node apps/mcp/dist/main.js --http; else exec node apps/api/dist/main.js; fi"]
