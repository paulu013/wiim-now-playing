# Build the paulu013 fork straight from the repo context (server/public is prebuilt & committed),
# not by cloning upstream. Multi-arch (amd64 + arm64) is produced by the GHCR publish workflow.

# --- Stage 1: production server deps ---
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- Stage 2: runtime ---
FROM node:22-alpine AS runner
RUN apk add --no-cache tini libcap
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY docker/docker-entrypoint.sh ./docker-entrypoint.sh

ARG VERSION
ENV VERSION=$VERSION PORT=80

# Allow the (non-root) node binary to bind privileged ports, create the data dir, drop privileges.
RUN setcap cap_net_bind_service=+ep /usr/local/bin/node \
    && mkdir -p /app/data \
    && chown -R node:node /app
USER node

EXPOSE 80
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
