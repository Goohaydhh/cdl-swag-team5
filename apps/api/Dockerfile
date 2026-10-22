# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t swag-api .
# Targets: `api` (default, the server) and `migrate` (runs prisma migrate deploy, then exits).

FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV CI=1
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@swag/api..."
# prisma generate reads DATABASE_URL from prisma.config.ts but does not connect.
RUN DATABASE_URL=postgresql://build@localhost/build pnpm --filter @swag/protocol build \
 && DATABASE_URL=postgresql://build@localhost/build pnpm --filter @swag/api build
RUN pnpm --filter @swag/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist

FROM build AS migrate
WORKDIR /repo/apps/api
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
