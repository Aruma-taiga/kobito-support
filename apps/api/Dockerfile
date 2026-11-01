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
# 本番では npm・corepack・yarn を使わない（`node dist/...` で起動する）。ベースイメージに同梱された、これらの内部ライブラリの
# 脆弱性（brace-expansion、pacote、picomatch、sigstore、ip-address）と攻撃対象を減らすため、runtime から取り除く。
RUN rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn*
ENV INVOICE_CHROMIUM_EXECUTABLE=/usr/bin/chromium
# コンテナ内では Chromium のサンドボックスが使えない（No usable sandbox）。コンテナ自体が隔離環境のため、ここでのみ無効にする。
ENV INVOICE_CHROMIUM_SANDBOX=false
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
