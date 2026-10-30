FROM node:22-bookworm-slim AS build
WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:shared && pnpm build:api
RUN pnpm --filter @kobito/api deploy --prod --legacy /prod/api

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /prod/api ./
USER node
EXPOSE 8080
CMD ["node", "dist/server.js"]
