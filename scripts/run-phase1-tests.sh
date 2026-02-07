#!/bin/bash
# Phase 1 Database Triggers & Functions Test Runner
# TASK-003 Test Execution Script
# Created: 2026-02-02

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DB_NAME="${DB_NAME:-supermemory_test}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
TEST_FILE="tests/database/phase1-triggers-functions.test.sql"
LOG_FILE="test_output.log"

# Function to print colored output
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Function to check if PostgreSQL is running
check_postgres() {
    print_header "Checking PostgreSQL Connection"

    if ! command -v psql &> /dev/null; then
        print_error "psql not found. Please install PostgreSQL client."
        exit 1
    fi

    if ! psql -h $DB_HOST -p $DB_PORT -U $DB_USER -lqt &> /dev/null; then
        print_error "Cannot connect to PostgreSQL at $DB_HOST:$DB_PORT"
        print_info "Make sure PostgreSQL is running and credentials are correct"
        exit 1
    fi

    print_success "PostgreSQL connection verified"
}

# Function to check if pgvector is installed
check_pgvector() {
    print_header "Checking pgvector Extension"

    # Check if extension is available
    if ! psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d postgres -tAc "SELECT 1 FROM pg_available_extensions WHERE name='vector'" | grep -q 1; then
        print_error "pgvector extension not available"
        print_info "Install pgvector: https://github.com/pgvector/pgvector"
        exit 1
    fi

    print_success "pgvector extension available"
}

# Function to create test database
create_test_db() {
    print_header "Setting Up Test Database"

    # Drop existing test database if it exists
    if psql -h $DB_HOST -p $DB_PORT -U $DB_USER -lqt | cut -d \| -f 1 | grep -qw $DB_NAME; then
        print_warning "Test database '$DB_NAME' already exists. Dropping it..."
        dropdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME
    fi

    # Create fresh test database
    print_info "Creating test database '$DB_NAME'..."
    createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME

    # Enable pgvector extension
    print_info "Enabling pgvector extension..."
    psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -c "CREATE EXTENSION vector;" > /dev/null

    print_success "Test database created and configured"
}

# Function to run migrations
run_migrations() {
    print_header "Running Database Migrations"

    MIGRATION_DIR="scripts/migrations"

    if [ ! -d "$MIGRATION_DIR" ]; then
        print_warning "Migration directory not found. Skipping migrations."
        return
    fi

    # Run migrations in order
    for migration in $(ls $MIGRATION_DIR/*.sql 2>/dev/null | sort); do
        # Skip test files
        if [[ $migration == *"test_"* ]]; then
            continue
        fi

        print_info "Running migration: $(basename $migration)"
        psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$migration" > /dev/null 2>&1 || {
            print_warning "Migration $(basename $migration) failed or already applied"
        }
    done

    print_success "Migrations completed"
}

# Function to run test suite
run_tests() {
    print_header "Running Phase 1 Test Suite"

    if [ ! -f "$TEST_FILE" ]; then
        print_error "Test file not found: $TEST_FILE"
        exit 1
    fi

    print_info "Executing tests from $TEST_FILE"
    print_info "Output will be saved to $LOG_FILE"

    # Run tests and capture output
    if psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f "$TEST_FILE" > "$LOG_FILE" 2>&1; then
        print_success "Test execution completed"
    else
        print_error "Test execution failed"
        return 1
    fi
}

# Function to analyze test results
analyze_results() {
    print_header "Analyzing Test Results"

    if [ ! -f "$LOG_FILE" ]; then
        print_error "Log file not found: $LOG_FILE"
        exit 1
    fi

    # Count test results
    PASSED=$(grep -c "TEST PASSED" "$LOG_FILE" 2>/dev/null || echo 0)
    FAILED=$(grep -c "TEST FAILED" "$LOG_FILE" 2>/dev/null || echo 0)
    WARNINGS=$(grep -c "PERFORMANCE WARNING" "$LOG_FILE" 2>/dev/null || echo 0)

    echo ""
    echo "Test Summary:"
    echo "============="
    print_success "Passed: $PASSED"

    if [ $FAILED -gt 0 ]; then
        print_error "Failed: $FAILED"
    else
        print_info "Failed: $FAILED"
    fi

    if [ $WARNINGS -gt 0 ]; then
        print_warning "Warnings: $WARNINGS"
    fi

    # Show performance metrics
    echo ""
    echo "Performance Metrics:"
    echo "==================="
    grep "PERFORMANCE:" "$LOG_FILE" | while read line; do
        print_info "$line"
    done

    # Show failures if any
    if [ $FAILED -gt 0 ]; then
        echo ""
        print_error "Failed Tests:"
        grep "TEST FAILED" "$LOG_FILE"
        return 1
    fi

    echo ""
    print_success "All tests passed! 🎉"
    return 0
}

# Function to show detailed logs
show_logs() {
    print_header "Detailed Test Output"
    cat "$LOG_FILE"
}

# Function to cleanup
cleanup() {
    print_header "Cleanup"

    if [ "$KEEP_DB" = "true" ]; then
        print_info "Keeping test database (KEEP_DB=true)"
        print_info "To clean up later: dropdb $DB_NAME"
    else
        print_info "Dropping test database..."
        dropdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME 2>/dev/null || true
        print_success "Test database dropped"
    fi

    if [ -f "$LOG_FILE" ]; then
        print_info "Test log saved to: $LOG_FILE"
    fi
}

# Main execution
main() {
    print_header "Phase 1 Database Test Suite"
    echo "Test Database: $DB_NAME"
    echo "PostgreSQL: $DB_USER@$DB_HOST:$DB_PORT"
    echo ""

    # Run all steps
    check_postgres
    check_pgvector
    create_test_db
    run_migrations
    run_tests

    # Analyze results
    if analyze_results; then
        EXIT_CODE=0
    else
        EXIT_CODE=1
    fi

    # Optional: show detailed logs
    if [ "$VERBOSE" = "true" ]; then
        show_logs
    fi

    # Cleanup
    cleanup

    exit $EXIT_CODE
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-db)
            KEEP_DB=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --keep-db    Keep test database after tests complete"
            echo "  --verbose    Show detailed test output"
            echo "  --help       Show this help message"
            echo ""
            echo "Environment Variables:"
            echo "  DB_NAME      Test database name (default: supermemory_test)"
            echo "  DB_USER      PostgreSQL user (default: postgres)"
            echo "  DB_HOST      PostgreSQL host (default: localhost)"
            echo "  DB_PORT      PostgreSQL port (default: 5432)"
            echo ""
            echo "Example:"
            echo "  DB_NAME=mytest $0 --keep-db --verbose"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Run main
main
