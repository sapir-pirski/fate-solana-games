FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# npm 10 cannot consume npm 11's platform-specific optional-dependency lock
# entries with `npm ci`; regular install still honors the committed versions.
RUN npm install --no-audit --no-fund

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    WRANGLER_LOG_PATH=/data/wrangler.log \
    MINIFLARE_REGISTRY_PATH=/data/registry
WORKDIR /app
RUN groupadd --system --gid 10001 fate && useradd --system --uid 10001 --gid fate --home /app fate
COPY --from=build --chown=fate:fate /app /app
RUN mkdir -p /data && chown fate:fate /data
USER fate
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/wrangler", "dev", "--config", "dist/server/wrangler.json", "--ip", "0.0.0.0", "--port", "3000", "--persist-to", "/data"]
