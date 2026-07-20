ARG NODE_IMAGE=node:20-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.30.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS builder
ARG NEXT_PUBLIC_API_BASE_URL
ARG API_INTERNAL_URL=http://api:4000
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV NODE_ENV=production
COPY packages ./packages
COPY apps ./apps
RUN pnpm build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @picup/api deploy --prod /out/api \
    && cd /out/api \
    && node node_modules/prisma/build/index.js generate --schema prisma/schema.prisma

FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder /out/api ./apps/api
COPY config/ai-config.example.json ./config/ai-config.example.json

RUN mkdir -p /app/storage/inputs /app/storage/outputs

EXPOSE 3000 4000
CMD ["node", "apps/web/server.js"]
