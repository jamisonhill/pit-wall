# Multi-stage build → small, non-root runtime image for the NAS (x86_64, low RAM).
# The app is a single lean Node process serving both the dashboard and the WebSocket.
#
# Node 24 (not 20) because the stats API reads the F1DB archive through node:sqlite,
# the SQLite driver built into Node since 22.5 — no native module to compile.

# ---- deps: install production node_modules only ----------------------------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Use npm ci when a lockfile exists (reproducible); fall back to install otherwise.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

# ---- runtime ---------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Copy installed deps and app source.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY web ./web

# Recordings and the F1DB archive both live on mounted volumes (see docker-compose.yml).
# The archive is ~73 MB and refreshes itself after each race weekend, so keeping it
# out of the image means Watchtower updates stay small and data stays current.
ENV ARCHIVE_DIR=/app/data
RUN mkdir -p /app/recordings /app/data && chown -R node:node /app
USER node

EXPOSE 8080
# A tiny healthcheck hitting the app's own /healthz endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8080) +'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
