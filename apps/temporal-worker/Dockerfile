# Multi-stage build for Perceo Temporal Worker

# Stage 1: Build
FROM node:20-alpine AS builder

# Install pnpm and configure for better memory/resource usage
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Set pnpm configuration for Docker builds (reduce memory usage)
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_OPTIONS="--max-old-space-size=2048"

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files for all packages (needed for pnpm workspace resolution)
COPY apps/temporal-worker/package.json ./apps/temporal-worker/
COPY packages/observer-engine/package.json ./packages/observer-engine/
COPY packages/supabase/package.json ./packages/supabase/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies with optimizations for Docker
# Configure pnpm for better reliability in Docker environments
RUN pnpm config set network-timeout 600000 && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-factor 2 && \
    pnpm config set store-dir /pnpm-store
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/temporal-worker ./apps/temporal-worker
COPY packages/observer-engine ./packages/observer-engine
COPY packages/supabase ./packages/supabase
COPY packages/typescript-config ./packages/typescript-config

# Build the worker and dependencies
# Use ... to include all dependencies in the build
RUN pnpm --filter @perceo/temporal-worker... build

# Stage 2: Production
FROM node:20-alpine AS runner

# Install pnpm and configure for better memory/resource usage
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Set pnpm configuration for Docker builds
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NODE_OPTIONS="--max-old-space-size=1024"

WORKDIR /app

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./

# Copy package.json files
COPY apps/temporal-worker/package.json ./apps/temporal-worker/
COPY packages/observer-engine/package.json ./packages/observer-engine/
COPY packages/supabase/package.json ./packages/supabase/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install production dependencies only with optimizations
RUN pnpm config set network-timeout 600000 && \
    pnpm config set fetch-retries 5 && \
    pnpm config set fetch-retry-factor 2 && \
    pnpm config set store-dir /pnpm-store
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
