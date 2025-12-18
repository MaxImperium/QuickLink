# =============================================================================
# QuickLink Redirect Service - Dockerfile
# =============================================================================
# Optimized for minimal size and fast startup

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/redirect/package.json ./apps/redirect/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/

RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=deps /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /app/turbo.json ./turbo.json

# Copy source code
COPY apps/redirect ./apps/redirect
COPY packages ./packages
COPY tsconfig.base.json ./

RUN pnpm turbo run build --filter=@quicklink/redirect

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 quicklink

# Copy built application and dependencies
COPY --from=builder --chown=quicklink:nodejs /app/apps/redirect/dist ./dist
COPY --from=builder --chown=quicklink:nodejs /app/apps/redirect/package.json ./
COPY --from=builder --chown=quicklink:nodejs /app/node_modules ./node_modules

USER quicklink

EXPOSE 3002

CMD ["node", "dist/index.js"]
