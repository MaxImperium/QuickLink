# =============================================================================
# QuickLink API Service - Dockerfile
# =============================================================================
# Multi-stage build for optimized production image

# Stage 1: Install dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

# Copy package files for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/cache/package.json ./packages/cache/
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/config/package.json ./packages/config/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build
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
COPY apps/api ./apps/api
COPY packages ./packages
COPY tsconfig.base.json ./

# Generate Prisma client and build
RUN pnpm --filter @quicklink/db db:generate
RUN pnpm turbo run build --filter=@quicklink/api

# Stage 3: Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 quicklink

# Copy built application and dependencies
COPY --from=builder --chown=quicklink:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=quicklink:nodejs /app/apps/api/package.json ./
COPY --from=builder --chown=quicklink:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=quicklink:nodejs /app/packages/db/node_modules ./packages/db/node_modules

# Copy Prisma client
COPY --from=builder --chown=quicklink:nodejs /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=quicklink:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=quicklink:nodejs /app/node_modules/@prisma ./node_modules/@prisma

USER quicklink

EXPOSE 3001

CMD ["node", "dist/index.js"]
