# syntax=docker/dockerfile:1

FROM node:24-bookworm AS base
WORKDIR /app

# Full tree, dev dependencies included. Only ever used to run the build.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Runtime tree. `duckdb` is a native module, so it is installed here on the
# same Debian 12 base the runner uses rather than copied out of the dev tree.
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# slim drops the compilers and headers the build needed; the app only needs a
# node runtime and glibc, both of which slim has.
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/static ./static
COPY --from=build /app/data/metadata ./data/metadata
COPY --from=build /app/package.json ./package.json

# The canonical DuckDB store is NOT baked in. It lives on the Fly volume at
# $DATA_PATH/observations.duckdb and is uploaded with `flyctl sftp put`, so a
# data refresh does not require a redeploy and the image stays small.
#
# src/, scripts/ and drizzle/ are also left out: running them needs tsx and
# drizzle-kit, which are dev dependencies and absent from this image. Build
# and migrate from a checkout instead.

EXPOSE 8080

CMD ["node", "build/index.js"]
