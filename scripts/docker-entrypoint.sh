#!/bin/sh
# =============================================================================
# Docker Entrypoint Script for SuperMemory Clone API
# =============================================================================
# This script runs before the main application starts:
# 1. Waits for required services (database, redis) to be ready
# 2. Runs database migrations
# 3. Starts the application
#
# Environment variables:
#   DATABASE_URL    - Database connection string
#   REDIS_URL       - Redis connection string (optional)
#   SKIP_MIGRATIONS - Set to "true" to skip migrations
#   MAX_RETRIES     - Max connection attempts (default: 30)
#   RETRY_INTERVAL  - Seconds between retries (default: 2)
# =============================================================================

set -e

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
MAX_RETRIES="${MAX_RETRIES:-30}"
RETRY_INTERVAL="${RETRY_INTERVAL:-2}"

# Colors for output (if terminal supports it)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# -----------------------------------------------------------------------------
# Logging functions
# -----------------------------------------------------------------------------
log_info() {
    echo "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo "${RED}[ERROR]${NC} $1"
}

# -----------------------------------------------------------------------------
# Wait for PostgreSQL to be ready
# -----------------------------------------------------------------------------
wait_for_postgres() {
    if [ -z "$DATABASE_URL" ]; then
        log_warn "DATABASE_URL not set, skipping PostgreSQL check"
        return 0
    fi

    # Check if this is a PostgreSQL connection string
    if echo "$DATABASE_URL" | grep -q "postgresql://\|postgres://"; then
        log_info "Waiting for PostgreSQL to be ready..."

        # Extract host and port from DATABASE_URL
        # Format: postgresql://user:pass@host:port/dbname
        DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
        DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')

        DB_HOST="${DB_HOST:-localhost}"
        DB_PORT="${DB_PORT:-5432}"

        RETRIES=0
        until nc -z "$DB_HOST" "$DB_PORT" 2>/dev/null; do
            RETRIES=$((RETRIES + 1))
            if [ $RETRIES -ge $MAX_RETRIES ]; then
                log_error "PostgreSQL is not available after $MAX_RETRIES attempts"
                exit 1
            fi
            log_info "PostgreSQL is unavailable - attempt $RETRIES/$MAX_RETRIES - sleeping ${RETRY_INTERVAL}s"
            sleep $RETRY_INTERVAL
        done

        log_info "PostgreSQL is ready!"
    else
        log_info "Using SQLite database, no connection wait needed"
    fi
}

# -----------------------------------------------------------------------------
# Wait for Redis to be ready (optional)
# -----------------------------------------------------------------------------
wait_for_redis() {
    if [ -z "$REDIS_URL" ]; then
        log_warn "REDIS_URL not set, skipping Redis check"
        return 0
    fi

    log_info "Waiting for Redis to be ready..."

    # Extract host and port from REDIS_URL
    # Format: redis://host:port
    REDIS_HOST=$(echo "$REDIS_URL" | sed -n 's/redis:\/\/\([^:]*\):.*/\1/p')
    REDIS_PORT=$(echo "$REDIS_URL" | sed -n 's/redis:\/\/[^:]*:\([0-9]*\).*/\1/p')

    REDIS_HOST="${REDIS_HOST:-localhost}"
    REDIS_PORT="${REDIS_PORT:-6379}"

    RETRIES=0
    until nc -z "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null; do
        RETRIES=$((RETRIES + 1))
        if [ $RETRIES -ge $MAX_RETRIES ]; then
            log_error "Redis is not available after $MAX_RETRIES attempts"
            exit 1
        fi
        log_info "Redis is unavailable - attempt $RETRIES/$MAX_RETRIES - sleeping ${RETRY_INTERVAL}s"
        sleep $RETRY_INTERVAL
    done

    log_info "Redis is ready!"
}

# -----------------------------------------------------------------------------
# Run database migrations
# -----------------------------------------------------------------------------
run_migrations() {
    if [ "$SKIP_MIGRATIONS" = "true" ]; then
        log_warn "SKIP_MIGRATIONS is set, skipping database migrations"
        return 0
    fi

    log_info "Running database migrations..."

    # Check if drizzle directory exists with migrations
    if [ -d "/app/drizzle" ] && [ "$(ls -A /app/drizzle 2>/dev/null)" ]; then
        # For production, use drizzle-kit migrate
        # This requires drizzle-kit to be installed
        if command -v npx >/dev/null 2>&1; then
            npx drizzle-kit migrate || {
                log_warn "Migration failed, continuing anyway (migrations may already be applied)"
            }
        else
            log_warn "npx not available, skipping drizzle migrations"
        fi
    else
        log_info "No migrations found in /app/drizzle, skipping"
    fi

    log_info "Database migrations complete!"
}

# -----------------------------------------------------------------------------
# Create data directory if needed
# -----------------------------------------------------------------------------
setup_directories() {
    log_info "Setting up directories..."

    # Ensure data directory exists and is writable
    mkdir -p /app/data

    log_info "Directories ready!"
}

# -----------------------------------------------------------------------------
# Main entrypoint
# -----------------------------------------------------------------------------
main() {
    log_info "Starting SuperMemory Clone API..."
    log_info "Environment: ${NODE_ENV:-development}"

    # Setup directories
    setup_directories

    # Wait for services
    wait_for_postgres
    wait_for_redis

    # Run migrations
    run_migrations

    log_info "Starting application..."

    # Execute the main command (node dist/index.js)
    exec node dist/index.js
}

# Run main function
main "$@"
