# syntax=docker/dockerfile:1

# Base image pinned by digest; the tag in the comment is what it was pulled as.
# node:26-alpine
FROM node@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /src
RUN npm install --global pnpm@12.21.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contract/package.json packages/contract/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm run build
# The server with its production dependencies only, as a self-contained folder.
RUN pnpm --filter @skill-issue/server deploy --prod --legacy /out/server

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
USER node
EXPOSE 4747
CMD ["node", "dist/main.js"]
