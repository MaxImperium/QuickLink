# =============================================================================
# QuickLink Redirect Service - Dockerfile
# =============================================================================
# Optimized for minimal size and fast startup

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/redirect/package.json ./apps/redirect/
COPY packages/*/package.json ./packages/

RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/redirect/node_modules ./apps/redirect/node_modules
COPY . .

RUN pnpm turbo run build --filter=@quicklink/redirect

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 quicklink

COPY --from=builder --chown=quicklink:nodejs /app/apps/redirect/dist ./dist
COPY --from=builder --chown=quicklink:nodejs /app/apps/redirect/package.json ./

USER quicklink

EXPOSE 3002

CMD ["node", "dist/index.js"]
