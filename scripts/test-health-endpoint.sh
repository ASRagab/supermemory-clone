#!/bin/bash

# =============================================================================
# Health Endpoint Test Script
# =============================================================================
# This script validates the /health endpoint implementation and Docker
# health check integration.
#
# Usage:
#   ./scripts/test-health-endpoint.sh [--docker]
#
# Options:
#   --docker    Test Docker health checks instead of local endpoint
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
HEALTH_ENDPOINT="${API_URL}/health"
DOCKER_MODE=false

# Parse arguments
if [[ "$1" == "--docker" ]]; then
  DOCKER_MODE=true
fi

# Helper functions
print_header() {
  echo -e "\n${BLUE}==============================================================================${NC}"
  echo -e "${BLUE}$1${NC}"
  echo -e "${BLUE}==============================================================================${NC}\n"
}

print_success() {
  echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
  echo -e "${RED}✗ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
  echo -e "${BLUE}ℹ $1${NC}"
}

# Test 1: Check if endpoint is accessible
test_endpoint_accessible() {
  print_header "TEST 1: Endpoint Accessibility"

  if curl -f -s -o /dev/null -w "%{http_code}" "${HEALTH_ENDPOINT}" > /dev/null 2>&1; then
    print_success "Health endpoint is accessible"
    return 0
  else
    print_error "Health endpoint is not accessible"
    print_info "Make sure the API server is running at ${API_URL}"
    return 1
  fi
}

# Test 2: Validate response format
test_response_format() {
  print_header "TEST 2: Response Format Validation"

  local response=$(curl -s "${HEALTH_ENDPOINT}")
  local status_code=$(curl -s -o /dev/null -w "%{http_code}" "${HEALTH_ENDPOINT}")

  print_info "HTTP Status Code: ${status_code}"
  print_info "Response Body:"
  echo "${response}" | jq . 2>/dev/null || echo "${response}"

  # Check if response is valid JSON
  if echo "${response}" | jq . > /dev/null 2>&1; then
    print_success "Response is valid JSON"
  else
    print_error "Response is not valid JSON"
    return 1
  fi

  # Check required fields
  local required_fields=("timestamp" "status" "version" "database" "uptime")
  for field in "${required_fields[@]}"; do
    if echo "${response}" | jq -e ".${field}" > /dev/null 2>&1; then
      print_success "Field '${field}' is present"
    else
      print_error "Field '${field}' is missing"
      return 1
    fi
  done

  # Validate status field value
  local status=$(echo "${response}" | jq -r '.status')
  if [[ "${status}" == "healthy" ]] || [[ "${status}" == "unhealthy" ]]; then
    print_success "Status field has valid value: ${status}"
  else
    print_error "Status field has invalid value: ${status}"
    return 1
  fi

  return 0
}

# Test 3: Check HTTP status codes
test_status_codes() {
  print_header "TEST 3: HTTP Status Code Validation"

  local status_code=$(curl -s -o /dev/null -w "%{http_code}" "${HEALTH_ENDPOINT}")

  if [[ "${status_code}" == "200" ]]; then
    print_success "Healthy state returns 200 OK"
  elif [[ "${status_code}" == "503" ]]; then
    print_warning "Service is unhealthy (503 Service Unavailable)"
    print_info "This may indicate a database connectivity issue"
  else
    print_error "Unexpected status code: ${status_code}"
    return 1
  fi

  return 0
}

# Test 4: Check database connectivity
test_database_connectivity() {
  print_header "TEST 4: Database Connectivity Check"

  local response=$(curl -s "${HEALTH_ENDPOINT}")
  local db_status=$(echo "${response}" | jq -r '.database')

  if [[ "${db_status}" == "connected" ]]; then
    print_success "Database is connected"
  elif [[ "${db_status}" == "disconnected" ]]; then
    print_error "Database is disconnected"
    return 1
  elif [[ "${db_status}" == "not_initialized" ]]; then
    print_error "Database is not initialized"
    return 1
  else
    print_warning "Database status is unknown: ${db_status}"
    return 1
  fi

  return 0
}

# Test 5: Validate uptime field
test_uptime_field() {
  print_header "TEST 5: Uptime Field Validation"

  local response=$(curl -s "${HEALTH_ENDPOINT}")
  local uptime=$(echo "${response}" | jq -r '.uptime')

  # Check if uptime is a number
  if [[ "${uptime}" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then
    print_success "Uptime is a valid number: ${uptime} seconds"

    # Convert to human-readable format
    local hours=$((${uptime%.*} / 3600))
    local minutes=$(((${uptime%.*} % 3600) / 60))
    local seconds=$((${uptime%.*} % 60))
    print_info "Process uptime: ${hours}h ${minutes}m ${seconds}s"
  else
    print_error "Uptime is not a valid number: ${uptime}"
    return 1
  fi

  return 0
}

# Test 6: Response time check
test_response_time() {
  print_header "TEST 6: Response Time Check"

  local response_time=$(curl -o /dev/null -s -w '%{time_total}' "${HEALTH_ENDPOINT}")

  print_info "Response time: ${response_time} seconds"

  # Convert to milliseconds
  local response_ms=$(echo "${response_time} * 1000" | bc)

  if (( $(echo "${response_ms} < 100" | bc -l) )); then
    print_success "Response time is excellent (< 100ms)"
  elif (( $(echo "${response_ms} < 500" | bc -l) )); then
    print_success "Response time is good (< 500ms)"
  elif (( $(echo "${response_ms} < 1000" | bc -l) )); then
    print_warning "Response time is acceptable (< 1s)"
  else
    print_error "Response time is too slow (> 1s)"
    return 1
  fi

  return 0
}

# Docker-specific tests
test_docker_health() {
  print_header "DOCKER: Container Health Status"

  if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed"
    return 1
  fi

  # Check if container is running
  if docker compose ps api 2>/dev/null | grep -q "Up"; then
    print_success "Container is running"
  else
    print_error "Container is not running"
    print_info "Start the container with: docker compose up -d api"
    return 1
  fi

  # Check health status
  local health_status=$(docker inspect supermemory-api --format='{{.State.Health.Status}}' 2>/dev/null || echo "none")

  print_info "Container health status: ${health_status}"

  if [[ "${health_status}" == "healthy" ]]; then
    print_success "Container is healthy"
  elif [[ "${health_status}" == "unhealthy" ]]; then
    print_error "Container is unhealthy"
    print_info "Check logs with: docker compose logs api"
    return 1
  elif [[ "${health_status}" == "starting" ]]; then
    print_warning "Container is still starting (within start_period)"
    print_info "Wait a few more seconds and try again"
  else
    print_warning "No health status available (health check may not be configured)"
  fi

  return 0
}

test_docker_health_logs() {
  print_header "DOCKER: Health Check Logs"

  local health_log=$(docker inspect supermemory-api --format='{{json .State.Health}}' 2>/dev/null)

  if [[ -n "${health_log}" ]]; then
    echo "${health_log}" | jq . || echo "${health_log}"
    print_success "Health check logs retrieved"
  else
    print_warning "No health check logs available"
  fi

  return 0
}

# Main execution
main() {
  echo -e "${GREEN}"
  echo "  ╔═══════════════════════════════════════════════════════════════╗"
  echo "  ║                                                               ║"
  echo "  ║          SuperMemory Clone - Health Endpoint Tests           ║"
  echo "  ║                                                               ║"
  echo "  ╚═══════════════════════════════════════════════════════════════╝"
  echo -e "${NC}"

  local total_tests=0
  local passed_tests=0
  local failed_tests=0

  run_test() {
    local test_name="$1"
    total_tests=$((total_tests + 1))

    if $test_name; then
      passed_tests=$((passed_tests + 1))
    else
      failed_tests=$((failed_tests + 1))
    fi
  }

  if [[ "${DOCKER_MODE}" == true ]]; then
    # Run Docker-specific tests
    run_test test_docker_health
    run_test test_docker_health_logs
    run_test test_endpoint_accessible
    run_test test_response_format
  else
    # Run standard tests
    run_test test_endpoint_accessible
    run_test test_response_format
    run_test test_status_codes
    run_test test_database_connectivity
    run_test test_uptime_field
    run_test test_response_time
  fi

  # Print summary
  print_header "TEST SUMMARY"
  echo -e "Total Tests:  ${total_tests}"
  echo -e "Passed:       ${GREEN}${passed_tests}${NC}"
  echo -e "Failed:       ${RED}${failed_tests}${NC}"

  if [[ ${failed_tests} -eq 0 ]]; then
    echo -e "\n${GREEN}✓ All tests passed!${NC}\n"
    exit 0
  else
    echo -e "\n${RED}✗ Some tests failed${NC}\n"
    exit 1
  fi
}

# Check dependencies
if ! command -v curl &> /dev/null; then
  print_error "curl is not installed"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  print_error "jq is not installed"
  print_info "Install with: brew install jq (macOS) or apt-get install jq (Ubuntu)"
  exit 1
fi

# Run main function
main
