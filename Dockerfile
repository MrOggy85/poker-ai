# syntax=docker/dockerfile:1

# The client build needs npm *and* deno: client/deno.json sets `nodeModulesDir: manual`, so
# react comes from npm's node_modules, but build.ts is itself a Deno script.
FROM denoland/deno:bin-2.9.7 AS deno-bin

FROM node:24-bookworm-slim AS client
COPY --from=deno-bin /deno /usr/local/bin/deno
WORKDIR /src/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# shared/ is imported by client/src, so it has to sit at the same relative depth as it does
# in the repo.
COPY shared/ /src/shared/
# .git is not in the build context, so build.ts's `git rev-parse` fallback would tag the
# bundle 'dev' and break cache-busting. deploy/build.sh passes the real hash.
ARG BUILD_HASH=dev
ENV BUILD_HASH=$BUILD_HASH
# build.ts writes to ../api/client/, which has to exist before esbuild runs.
RUN mkdir -p /src/api/client && npm run build

FROM denoland/deno:2.9.7 AS runtime
WORKDIR /app/api
COPY api/ ./
# server.ts resolves its static root as ./client relative to its own module URL.
COPY --from=client /src/api/client ./client
# Both are imported with paths relative to /app/api, so the sibling layout has to survive.
COPY shared/ /app/shared/
COPY config/ /app/config/
# Baked into the image so a cold start never has to reach jsr.io or npm.
RUN deno cache --config deno.json main.ts && chown -R 1000:1000 /deno-dir

# The server binds all interfaces *inside* the container; deploy/start.sh publishes the port
# only on the host's loopback, so the sole way in is `tailscale serve` on the host.
ENV HOST=0.0.0.0 \
    PORT=8780 \
    TZ=Asia/Tokyo

USER 1000
# Mirrors api/deno.json's `start` task, with the write scope pointed at the log volume.
CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write=/app/data", "--allow-env", "main.ts"]
