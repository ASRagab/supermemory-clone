#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

SKIP_DOCKER=0
SKIP_API_KEYS=0
SKIP_CLAUDE=0
NON_INTERACTIVE=0
SKIP_BUILD=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/install.sh [options]

Options:
  --skip-docker         Skip docker startup and migrations
  --skip-api-keys       Do not prompt for API keys
  --skip-claude         Skip Claude Code MCP registration
  --skip-build          Skip npm run build
  --non-interactive     Use defaults and avoid prompts
  -h, --help            Show this help
USAGE
}

log() {
  local level="$1"
  shift
  printf '[%s] %s\n' "$level" "$*"
}

fail() {
  log "FAIL" "$*"
  exit 1
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

require_command() {
  local name="$1"
  if ! command_exists "$name"; then
    fail "Missing required command: $name"
  fi
}

confirm() {
  local prompt="$1"
  local default_answer="$2" # y or n

  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    [[ "$default_answer" == "y" ]]
    return
  fi

  local label="[y/N]"
  if [[ "$default_answer" == "y" ]]; then
    label="[Y/n]"
  fi

  read -r -p "$prompt $label " reply
  reply="${reply,,}"

  if [[ -z "$reply" ]]; then
    [[ "$default_answer" == "y" ]]
    return
  fi

  [[ "$reply" == "y" || "$reply" == "yes" ]]
}

set_env_value() {
  local key="$1"
  local value="$2"
  local file=".env"
  local tmp_file
  tmp_file="$(mktemp)"

  if grep -q "^${key}=" "$file"; then
    awk -v k="$key" -v v="$value" '
      BEGIN { FS = OFS = "=" }
      $1 == k { $0 = k "=" v }
      { print }
    ' "$file" > "$tmp_file"
    mv "$tmp_file" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
    rm -f "$tmp_file"
  fi
}

wait_for_container_health() {
  local container="$1"
  local timeout_seconds="$2"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    local status
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container" 2>/dev/null || true)"

    if [[ "$status" == "healthy" || "$status" == "running" ]]; then
      log "OK" "$container is $status"
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  fail "Timed out waiting for container health: $container"
}

start_compose_services() {
  if docker compose up -d postgres redis; then
    return 0
  fi

  log "WARN" "docker compose up failed, attempting one cleanup+retry"
  docker compose down >/dev/null 2>&1 || true
  docker rm -f supermemory-postgres supermemory-redis >/dev/null 2>&1 || true
  docker network rm supermemory-network >/dev/null 2>&1 || true

  docker compose up -d postgres redis
}

for arg in "$@"; do
  case "$arg" in
    --skip-docker)
      SKIP_DOCKER=1
      ;;
    --skip-api-keys)
      SKIP_API_KEYS=1
      ;;
    --skip-claude)
      SKIP_CLAUDE=1
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $arg"
      ;;
  esac
done

log "INFO" "Starting Supermemory turnkey setup"

require_command node
require_command npm

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
  fail "Node.js >= 20 is required"
fi

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  require_command docker
  docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required"
fi

log "INFO" "Installing npm dependencies"
npm install

created_env=0
if [[ ! -f .env ]]; then
  cp .env.example .env
  created_env=1
  log "OK" "Created .env from .env.example"
fi

if [[ "$created_env" -eq 1 ]]; then
  set_env_value "DATABASE_URL" "postgresql://supermemory:supermemory_secret@localhost:15432/supermemory"
  set_env_value "REDIS_URL" "redis://localhost:16379"
  set_env_value "API_PORT" "13000"
  set_env_value "API_HOST_PORT" "13000"
  set_env_value "POSTGRES_HOST_PORT" "15432"
  set_env_value "REDIS_HOST_PORT" "16379"
fi

# Migrate local defaults from previous standard-port config to non-conflicting host ports.
if grep -q "^DATABASE_URL=postgresql://supermemory:supermemory_secret@localhost:5432/supermemory$" .env; then
  set_env_value "DATABASE_URL" "postgresql://supermemory:supermemory_secret@localhost:15432/supermemory"
  log "INFO" "Updated DATABASE_URL from localhost:5432 to localhost:15432"
fi

if grep -q "^REDIS_URL=redis://localhost:6379$" .env; then
  set_env_value "REDIS_URL" "redis://localhost:16379"
  log "INFO" "Updated REDIS_URL from localhost:6379 to localhost:16379"
fi

if grep -q "^API_PORT=3000$" .env; then
  set_env_value "API_PORT" "13000"
  log "INFO" "Updated API_PORT from 3000 to 13000"
fi

if ! grep -q "^API_HOST_PORT=" .env; then
  set_env_value "API_HOST_PORT" "13000"
fi

if ! grep -q "^POSTGRES_HOST_PORT=" .env; then
  set_env_value "POSTGRES_HOST_PORT" "15432"
fi

if ! grep -q "^REDIS_HOST_PORT=" .env; then
  set_env_value "REDIS_HOST_PORT" "16379"
fi

if [[ "$SKIP_API_KEYS" -eq 0 && "$NON_INTERACTIVE" -eq 0 ]]; then
  if confirm "Configure API keys now?" "n"; then
    read -r -p "OPENAI_API_KEY (optional, press Enter to skip): " openai_key
    read -r -p "ANTHROPIC_API_KEY (optional, press Enter to skip): " anthropic_key
    read -r -p "LLM provider [openai/anthropic/none] (none): " llm_provider

    llm_provider="${llm_provider,,}"
    case "$llm_provider" in
      openai|anthropic|none|"") ;;
      *) llm_provider="none" ;;
    esac

    if [[ -n "$openai_key" ]]; then
      set_env_value "OPENAI_API_KEY" "$openai_key"
    fi

    if [[ -n "$anthropic_key" ]]; then
      set_env_value "ANTHROPIC_API_KEY" "$anthropic_key"
    fi

    if [[ "$llm_provider" == "openai" ]]; then
      set_env_value "LLM_PROVIDER" "openai"
      set_env_value "LLM_MODEL" "gpt-5.1-nano"
    elif [[ "$llm_provider" == "anthropic" ]]; then
      set_env_value "LLM_PROVIDER" "anthropic"
      set_env_value "LLM_MODEL" "claude-4-5-haiku-20251001"
    else
      set_env_value "LLM_PROVIDER" ""
      set_env_value "LLM_MODEL" ""
    fi

    log "OK" "Saved API key/provider configuration to .env"
  else
    log "WARN" "Skipping API key setup"
  fi
fi

if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  log "INFO" "Starting Docker services: postgres, redis"
  start_compose_services

  wait_for_container_health "supermemory-postgres" 120
  wait_for_container_health "supermemory-redis" 60

  log "INFO" "Running database migrations"
  ./scripts/migrations/run_migrations.sh
else
  log "WARN" "Skipped Docker startup and migrations"
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  log "INFO" "Building project"
  npm run build
else
  log "WARN" "Skipped project build"
fi

if [[ "$SKIP_CLAUDE" -eq 0 ]]; then
  if command_exists claude; then
    should_register=0
    if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
      should_register=1
    elif confirm "Register MCP server with Claude Code for this project?" "y"; then
      should_register=1
    fi

    if [[ "$should_register" -eq 1 ]]; then
      if claude mcp list 2>/dev/null | grep -q "supermemory"; then
        log "OK" "Claude Code MCP server 'supermemory' already registered"
      else
        if claude mcp add supermemory --scope project -- node "$REPO_ROOT/dist/mcp/index.js"; then
          log "OK" "Registered MCP server with Claude Code"
        else
          log "WARN" "Could not register MCP automatically. Run: npm run mcp:setup"
        fi
      fi
    else
      log "WARN" "Skipped Claude Code MCP registration"
    fi
  else
    log "WARN" "Claude CLI not found. Install Claude Code or run npm run mcp:setup later"
  fi
else
  log "WARN" "Skipped Claude Code setup"
fi

connectivity_ok=0
if npm run doctor; then
  connectivity_ok=1
  log "OK" "Connectivity checks passed"
else
  log "WARN" "Connectivity checks found issues. Review output above"
fi

api_port="$(awk -F= '/^API_PORT=/{print $2}' .env | tail -n 1)"
if [[ -z "$api_port" ]]; then
  api_port="13000"
fi

cat <<GUIDE

Setup complete.

Basic usage flow:
  1) Start the API:
       npm run dev
  2) Verify health:
       curl http://localhost:${api_port}/health
  3) Add a document:
       curl -X POST http://localhost:${api_port}/api/v1/documents -H "Content-Type: application/json" -d '{"content":"My first memory"}'
  4) Search:
       curl -X POST http://localhost:${api_port}/api/v1/search -H "Content-Type: application/json" -d '{"query":"first memory"}'

If you skipped API keys:
  - Edit .env and set OPENAI_API_KEY and/or ANTHROPIC_API_KEY
  - Then rerun connectivity checks:
      npm run doctor

If you skipped Docker:
  - Start services manually, then run:
      ./scripts/migrations/run_migrations.sh
      npm run doctor
GUIDE

if [[ "$connectivity_ok" -ne 1 ]]; then
  exit 1
fi
