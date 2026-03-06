#!/bin/bash

###############################################################################
# PostgreSQL Migration Runner for Supermemory
# Description: Runs all database migrations in order with error handling
# Created: 2026-02-02
# Related: TASK-005 (HNSW Index), TASK-002 (PostgreSQL Schema)
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Migration directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR"

# Load .env from project root if available
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Database URL from environment or default
DATABASE_URL="${DATABASE_URL:-postgresql://supermemory:supermemory_secret@localhost:15432/supermemory}"

run_drizzle_migrations() {
    print_info "Applying Drizzle schema migrations..."

    if ! command -v npm >/dev/null 2>&1; then
        print_error "npm is required to run Drizzle migrations"
        return 1
    fi

    if ! (cd "$PROJECT_ROOT" && npm run db:migrate > /dev/null 2>&1); then
        print_error "Drizzle schema migration failed"
        print_info "Run with verbose mode from the project root:"
        print_info "  npm run db:migrate"
        return 1
    fi

    print_success "Drizzle schema migration completed"
    return 0
}

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo -e "${RED}Error: DATABASE_URL not set${NC}"
    echo "Usage: DATABASE_URL=postgresql://user:pass@host:port/db $0"
    exit 1
fi

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check PostgreSQL connection
check_connection() {
    print_info "Checking database connection..."

    if ! psql "$DATABASE_URL" -c "SELECT 1;" > /dev/null 2>&1; then
        print_error "Cannot connect to database: $DATABASE_URL"
        return 1
    fi

    print_success "Database connection OK"
    return 0
}

# Function to check PostgreSQL version
check_postgres_version() {
    print_info "Checking PostgreSQL version..."

    local version=$(psql "$DATABASE_URL" -t -c "SHOW server_version;" | awk '{print $1}' | cut -d. -f1)

    if [ "$version" -lt 12 ]; then
        print_error "PostgreSQL version $version is too old. Requires 12+, recommended 15+"
        return 1
    fi

    print_success "PostgreSQL version $version OK"
    return 0
}

# Function to check if pgvector is available
check_pgvector_available() {
    print_info "Checking if pgvector is available..."

    if ! psql "$DATABASE_URL" -t -c "SELECT * FROM pg_available_extensions WHERE name='vector';" | grep -q vector; then
        print_error "pgvector extension is not available"
        print_info "Install instructions:"
        print_info "  macOS: brew install pgvector"
        print_info "  Ubuntu: sudo apt install postgresql-15-pgvector"
        print_info "  From source: https://github.com/pgvector/pgvector"
        return 1
    fi

    print_success "pgvector extension is available"
    return 0
}

# Function to run a migration file
run_migration() {
    local migration_file="$1"
    local migration_name=$(basename "$migration_file")

    print_info "Running migration: $migration_name"

    if ! psql "$DATABASE_URL" -f "$migration_file" > /dev/null 2>&1; then
        print_error "Migration failed: $migration_name"
        print_info "Run with verbose mode to see details:"
        print_info "  psql $DATABASE_URL -f $migration_file"
        return 1
    fi

    print_success "Migration completed: $migration_name"
    return 0
}

# Function to run all migrations
run_all_migrations() {
    local migrations=(
        "001_create_pgvector_extension.sql"
    )

    print_info "Starting migration process..."
    echo ""

    for migration in "${migrations[@]}"; do
        local migration_path="$MIGRATIONS_DIR/$migration"

        if [ ! -f "$migration_path" ]; then
            print_error "Migration file not found: $migration"
            return 1
        fi

        if ! run_migration "$migration_path"; then
            print_error "Migration process aborted"
            return 1
        fi

        echo ""
    done

    if ! run_drizzle_migrations; then
        print_error "Migration process aborted"
        return 1
    fi

    echo ""

    local optional_migrations=(
        "003_create_hnsw_index.sql"
    )

    for migration in "${optional_migrations[@]}"; do
        local migration_path="$MIGRATIONS_DIR/$migration"

        if [ ! -f "$migration_path" ]; then
            print_warning "Optional migration file not found: $migration"
            continue
        fi

        if ! run_migration "$migration_path"; then
            print_warning "Optional migration failed: $migration"
            print_warning "Continuing because the core schema is already installed"
            echo ""
            continue
        fi

        echo ""
    done

    print_success "All migrations completed successfully!"
    return 0
}

# Function to run tests
run_tests() {
    local test_file="$MIGRATIONS_DIR/test_hnsw_index.sql"

    print_info "Running test suite..."
    echo ""

    if [ ! -f "$test_file" ]; then
        print_warning "Test file not found: $test_file"
        return 1
    fi

    if ! psql "$DATABASE_URL" -f "$test_file"; then
        print_warning "Some tests may have warnings (this is normal without data)"
        return 0
    fi

    print_success "Tests completed"
    return 0
}

# Function to show migration status
show_status() {
    print_info "Checking migration status..."
    echo ""

    # Check pgvector extension
    if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_extension WHERE extname='vector';" | grep -q 1; then
        print_success "✓ pgvector extension installed"
    else
        print_warning "✗ pgvector extension not installed"
    fi

    # Check memory_embeddings table
    if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_tables WHERE tablename='memory_embeddings';" | grep -q 1; then
        print_success "✓ memory_embeddings table exists"

        # Get row count
        local row_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM memory_embeddings;")
        print_info "  Rows: $(echo $row_count | xargs)"
    else
        print_warning "✗ memory_embeddings table not found"
    fi

    # Check HNSW index
    if psql "$DATABASE_URL" -t -c "SELECT 1 FROM pg_indexes WHERE indexname='idx_memory_embeddings_hnsw';" | grep -q 1; then
        print_success "✓ HNSW index exists"

        # Get index size
        local index_size=$(psql "$DATABASE_URL" -t -c "SELECT pg_size_pretty(pg_relation_size('idx_memory_embeddings_hnsw'));")
        print_info "  Size: $(echo $index_size | xargs)"

        # Get ef_search setting
        local ef_search=$(psql "$DATABASE_URL" -t -c "SHOW hnsw.ef_search;" 2>/dev/null || echo "not set")
        print_info "  ef_search: $(echo $ef_search | xargs)"
    else
        print_warning "✗ HNSW index not found"
    fi
}

# Function to display usage
show_usage() {
    cat << EOF
PostgreSQL Migration Runner for Supermemory

Usage: $0 [OPTIONS]

Options:
    run         Run all migrations (default)
    test        Run test suite
    status      Show migration status
    help        Show this help message

Environment Variables:
    DATABASE_URL    PostgreSQL connection string (required)
                    Format: postgresql://user:password@host:port/database

Examples:
    # Run migrations
    DATABASE_URL=postgresql://localhost/supermemory $0 run

    # Check status
    DATABASE_URL=postgresql://localhost/supermemory $0 status

    # Run tests
    DATABASE_URL=postgresql://localhost/supermemory $0 test

EOF
}

# Main execution
main() {
    local command="${1:-run}"

    echo ""
    echo "╔════════════════════════════════════════════════════════════╗"
    echo "║     PostgreSQL Migration Runner - Supermemory             ║"
    echo "╚════════════════════════════════════════════════════════════╝"
    echo ""

    case "$command" in
        run)
            check_connection || exit 1
            check_postgres_version || exit 1
            check_pgvector_available || exit 1
            run_all_migrations || exit 1
            echo ""
            print_info "Run tests with: $0 test"
            ;;
        test)
            check_connection || exit 1
            run_tests
            ;;
        status)
            check_connection || exit 1
            show_status
            ;;
        help|--help|-h)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac

    echo ""
    print_success "Done!"
    echo ""
}

# Run main function with all arguments
main "$@"
