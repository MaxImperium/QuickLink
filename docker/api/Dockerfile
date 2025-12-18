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

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/*/package.json ./packages/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.12.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

# Build the API
RUN pnpm turbo run build --filter=@quicklink/api

# Stage 3: Production image
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 quicklink

# Copy built application
COPY --from=builder --chown=quicklink:nodejs /app/apps/api/dist ./dist
COPY --from=builder --chown=quicklink:nodejs /app/apps/api/package.json ./

USER quicklink

EXPOSE 3001

CMD ["node", "dist/index.js"]
