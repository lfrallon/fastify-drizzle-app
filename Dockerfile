# ========================================
# Optimized Multi-Stage Dockerfile
# Fastify + TypeScript + pnpm
# ========================================

ARG NODE_VERSION=24.11.1-alpine

# ========================================
# Base Stage
# ========================================
FROM node:${NODE_VERSION} AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app

# Enable pnpm via Corepack
RUN corepack enable

# Create non-root user
RUN addgroup -S nodejs -g 1001 && \
    adduser -S nodejs -u 1001 -G nodejs

# ========================================
# Dependencies Stage
# ========================================
FROM base AS deps

# Copy dependency manifests
COPY package.json pnpm-lock.yaml ./

# Non-interactively allow esbuild to run its postinstall binary download 
# (Injects configurations compatible across pnpm v9, v10, and v11)
RUN node -e " \
    const fs = require('fs'); \
    const pkg = JSON.parse(fs.readFileSync('package.json')); \
    pkg.pnpm = { ...pkg.pnpm, onlyBuiltDependencies: ['esbuild'] }; \
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)); \
    fs.writeFileSync('pnpm-workspace.yaml', 'packages:\n  - \'.\'\nallowBuilds:\n  esbuild: true\nonlyBuiltDependencies:\n  - esbuild\n'); \
    "

# Install production dependencies only
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install \
    --prod \
    --frozen-lockfile

# ========================================
# Build Dependencies Stage
# ========================================
FROM base AS build-deps

COPY package.json pnpm-lock.yaml ./

# Non-interactively allow esbuild to run its postinstall binary download 
RUN node -e " \
    const fs = require('fs'); \
    const pkg = JSON.parse(fs.readFileSync('package.json')); \
    pkg.pnpm = { ...pkg.pnpm, onlyBuiltDependencies: ['esbuild'] }; \
    fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2)); \
    fs.writeFileSync('pnpm-workspace.yaml', 'packages:\n  - \'.\'\nallowBuilds:\n  esbuild: true\nonlyBuiltDependencies:\n  - esbuild\n'); \
    "

# Install all dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ========================================
# Build Stage
# ========================================
FROM build-deps AS build

# Copy source code
COPY . .

# Build application
RUN pnpm run build

# ========================================
# Development Stage
# ========================================
FROM build-deps AS development

ENV NODE_ENV=development

COPY . .

USER nodejs

EXPOSE 3006

CMD ["pnpm", "run", "dev:docker"]

# ========================================
# Production Stage
# ========================================
# OPTIMIZATION: Inherit from base to inherit working dir, users, and corepack setup
FROM base AS production

ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=256 --enable-source-maps"

# Copy production node_modules
COPY --from=deps /app/node_modules ./node_modules

# Copy package manifest
COPY --from=build /app/package.json ./

# Copy compiled output
COPY --from=build /app/dist ./dist

# Ownership
RUN chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3006

CMD ["node", "dist/index.mjs"]