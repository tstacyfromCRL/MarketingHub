FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY . .
RUN pnpm install --frozen-lockfile --filter @mh/worker... \
 && pnpm --filter @mh/db generate \
 && pnpm --filter @mh/worker build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y openssl fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]
