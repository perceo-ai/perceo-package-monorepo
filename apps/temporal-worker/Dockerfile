# Multi-stage build for Perceo Temporal Worker

# Stage 1: Build
FROM node:20-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files for all packages
COPY apps/temporal-worker/package.json ./apps/temporal-worker/
COPY packages/observer-engine/package.json ./packages/observer-engine/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/temporal-worker ./apps/temporal-worker
COPY packages ./packages

# Build the worker and dependencies
RUN pnpm --filter @perceo/temporal-worker build

# Stage 2: Production
FROM node:20-alpine AS runner

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files
COPY apps/temporal-worker/package.json ./apps/temporal-worker/
COPY packages/observer-engine/package.json ./packages/observer-engine/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts from builder
COPY --from=builder /app/apps/temporal-worker/dist ./apps/temporal-worker/dist
COPY --from=builder /app/packages/observer-engine/dist ./packages/observer-engine/dist

# Set working directory to worker
WORKDIR /app/apps/temporal-worker

# Run as non-root user
USER node

# Start the worker
CMD ["node", "dist/index.js"]
