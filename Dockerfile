# =============================================================================
# SuperMemory Clone API - Multi-stage Dockerfile
# =============================================================================
# This Dockerfile uses a multi-stage build for optimal image size:
# - Stage 1 (deps): Install all dependencies
# - Stage 2 (builder): Build TypeScript to JavaScript
# - Stage 3 (runner): Production runtime with minimal footprint
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
# Install all dependencies including devDependencies for building
FROM node:20-alpine AS deps

# Install build dependencies required for native modules (better-sqlite3)
# - python3 and make are needed for node-gyp
# - g++ is the C++ compiler
# - libc6-compat ensures glibc compatibility
RUN apk add --no-cache python3 make g++ libc6-compat

WORKDIR /app

# Copy package files for dependency installation
# This layer is cached unless package*.json changes
COPY package.json package-lock.json ./

# Install all dependencies (including dev for TypeScript compilation)
# Use --legacy-peer-deps if you encounter peer dependency issues
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
# Compile TypeScript to JavaScript
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code and configuration files
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY drizzle.config.ts ./

# Build TypeScript
RUN npm run build

# Generate drizzle migrations if schema exists
# This ensures migrations are available in production
RUN npm run db:generate || true

# Prune dev dependencies for production
# This removes TypeScript, test frameworks, etc.
RUN npm prune --production

# -----------------------------------------------------------------------------
# Stage 3: Production Runner
# -----------------------------------------------------------------------------
# Minimal production image
FROM node:20-alpine AS runner

# Add labels for container metadata
LABEL org.opencontainers.image.title="SuperMemory Clone API"
LABEL org.opencontainers.image.description="Personal AI memory assistant with semantic search"
LABEL org.opencontainers.image.version="1.0.0"
LABEL org.opencontainers.image.vendor="SuperMemory Clone"

# Install runtime dependencies only
# - libc6-compat: Required for better-sqlite3 native bindings
# - tini: Proper init system for signal handling in containers
RUN apk add --no-cache libc6-compat tini

# Create non-root user for security
# Running as root in containers is a security risk
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 supermemory

WORKDIR /app

# Create data directory for SQLite database
# This directory should be mounted as a volume in production
RUN mkdir -p /app/data && chown -R supermemory:nodejs /app/data

# Copy production files from builder
COPY --from=builder --chown=supermemory:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=supermemory:nodejs /app/dist ./dist
COPY --from=builder --chown=supermemory:nodejs /app/package.json ./
COPY --from=builder --chown=supermemory:nodejs /app/drizzle ./drizzle

# Copy entrypoint script
COPY --chown=supermemory:nodejs scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Switch to non-root user
USER supermemory

# Set environment variables
# NODE_ENV=production enables production optimizations
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3000

# Expose API port
EXPOSE 3000

# Health check to verify the container is running properly
# Checks the /health endpoint every 30 seconds
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use tini as init system for proper signal handling
# This ensures SIGTERM is properly forwarded to Node.js
ENTRYPOINT ["/sbin/tini", "--"]

# Run with node directly (not npm) for proper signal handling
# npm doesn't forward signals properly to child processes
CMD ["/app/docker-entrypoint.sh"]
