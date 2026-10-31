FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:shared && pnpm build:api
RUN pnpm --filter @kobito/api deploy --prod --legacy /prod/api

FROM build AS migrate
USER node
CMD ["sh", "-c", "pnpm --filter @kobito/db migrate && pnpm --filter @kobito/db seed"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
ENV INVOICE_CHROMIUM_EXECUTABLE=/usr/bin/chromium
# コンテナ内では Chromium のサンドボックスが使えない（No usable sandbox）。コンテナ自体が隔離環境のため、ここでのみ無効にする。
ENV INVOICE_CHROMIUM_SANDBOX=false
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
