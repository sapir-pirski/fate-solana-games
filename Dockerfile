FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS runtime-dependencies
RUN npm prune --omit=dev --no-audit

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim@sha256:f32b81066cde10a75dbac96646099533316d94bac4150c55da1636e1f0ffdc46 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    XDG_CONFIG_HOME=/data/config \
    WRANGLER_LOG_PATH=/data/wrangler.log \
    MINIFLARE_REGISTRY_PATH=/data/registry
WORKDIR /app
# The pinned Node image already includes the system CA trust bundle.
RUN groupadd --system --gid 10001 fate && useradd --system --uid 10001 --gid fate --home /app fate
COPY --from=runtime-dependencies --chown=fate:fate /app/node_modules /app/node_modules
COPY --from=build --chown=fate:fate /app/dist /app/dist
COPY --from=build --chown=fate:fate /app/scripts/start-container.mjs /app/scripts/start-container.mjs
COPY --from=build --chown=fate:fate /app/package.json /app/package.json
RUN mkdir -p /data && chown fate:fate /data
USER fate
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=15s --start-period=60s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(12000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-container.mjs"]
