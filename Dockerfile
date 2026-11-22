# syntax=docker/dockerfile:1

# Base image pinned by digest; the tag in the comment is what it was pulled as.
# node:26-alpine
FROM node@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /src
# pnpm from a tarball whose checksum is pinned in the script, the version package.json names.
COPY package.json ./
COPY scripts/install-pnpm.sh scripts/
RUN sh scripts/install-pnpm.sh

COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json packages/contract/
COPY packages/pack/package.json packages/pack/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY apps/e2e/package.json apps/e2e/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm run build
# The server and the command-line tool with their production dependencies only, each a self-contained folder.
RUN pnpm --filter @skill-issue/server deploy --prod --legacy /out/server \
 && pnpm --filter @skill-issue/cli deploy --prod --legacy /out/cli
# What the image ships, as CycloneDX: the server, the browser app (whose dependencies are bundled into it) and the command-line tool.
RUN pnpm --filter @skill-issue/server --filter @skill-issue/web --filter @skill-issue/cli \
      sbom --sbom-format cyclonedx --sbom-spec-version 1.6 --sbom-type application --prod --split --out '/out/sbom/%s.cdx.json'

# node:26-alpine
FROM node@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4747 \
    WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out/server/package.json ./
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /out/server/dist ./dist
COPY --from=build /src/apps/web/dist ./web
COPY --from=build /out/cli/package.json ./cli/
COPY --from=build /out/cli/node_modules ./cli/node_modules
COPY --from=build /out/cli/dist ./cli/dist
COPY --from=build /out/sbom ./sbom
USER node
EXPOSE 4747
# Healthy when the application answers its health endpoint, which also asks the database; node is the only tool the image has for it.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4747/api/v1/health', { signal: AbortSignal.timeout(2500) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/main.js"]
