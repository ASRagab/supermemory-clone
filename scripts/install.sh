#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

ACTION="install"
SKIP_DOCKER=0
SKIP_API_KEYS=0
SKIP_CLAUDE=0
NON_INTERACTIVE=0
SKIP_BUILD=0
SKIP_API_START=0
MCP_SCOPE="user"
MCP_SCOPE_EXPLICIT=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/install.sh [command] [options]

Commands:
  install               Install or repair local setup (default)
  update                Reinstall app components, preserve Postgres/Redis data, and attempt DB migrations
  uninstall             Remove local install artifacts, docker resources, and Claude MCP registrations

Options:
  --skip-docker         Skip docker startup (install/update only)
  --skip-api-keys       Do not prompt for API keys (install/update only)
  --skip-claude         Skip Claude Code MCP registration removal/setup
  --skip-build          Skip npm run build (install/update only)
  --skip-api-start      Skip auto-starting the API container after install/update
  --scope <scope>       MCP scope override: user (default), project, or local
  --non-interactive     Use defaults and avoid prompts
  -h, --help            Show this help

Examples:
  ./scripts/install.sh
  ./scripts/install.sh update --skip-claude
  ./scripts/install.sh install --skip-api-start
  ./scripts/install.sh --scope project
  ./scripts/install.sh uninstall --non-interactive
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

validate_mcp_scope() {
  local scope="$1"
  case "$scope" in
    user|project|local)
      return 0
      ;;
    *)
      fail "Invalid MCP scope: $scope (expected: user, project, or local)"
      ;;
  esac
}

prompt_mcp_scope() {
  local answer
  read -r -p "MCP registration scope [user/project/local] (user): " answer
  answer="${answer,,}"
  if [[ -z "$answer" ]]; then
    echo "user"
    return 0
  fi

  validate_mcp_scope "$answer"
  echo "$answer"
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

ensure_env_defaults() {
  local created_env="$1"

  if [[ "$created_env" -eq 1 ]]; then
    set_env_value "DATABASE_URL" "postgresql://supermemory:supermemory_secret@localhost:15432/supermemory"
    set_env_value "REDIS_URL" "redis://localhost:16379"
    set_env_value "API_PORT" "13000"
    set_env_value "API_HOST_PORT" "13000"
    set_env_value "POSTGRES_HOST_PORT" "15432"
    set_env_value "REDIS_HOST_PORT" "16379"
    return
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
}

read_env_value() {
  local key="$1"
  awk -F= -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1) }' .env | tail -n 1
}

migrate_legacy_default_ports() {
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

start_api_stack() {
  if docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api postgres redis; then
    return 0
  fi

  log "WARN" "docker compose (api stack) up failed, attempting one cleanup+retry"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml down >/dev/null 2>&1 || true
  docker rm -f supermemory-api supermemory-postgres supermemory-redis >/dev/null 2>&1 || true
  docker network rm supermemory-network >/dev/null 2>&1 || true

  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api postgres redis
}

verify_api_health() {
  local api_host_port="$1"
  local health_url="http://localhost:${api_host_port}/health"
  local attempt=0
  local max_attempts=30

  wait_for_container_health "supermemory-api" 120

  if ! command_exists curl; then
    log "WARN" "curl not found; skipped HTTP health probe. Container health is already ready"
    return 0
  fi

  until curl --fail --silent --show-error "$health_url" >/dev/null; do
    attempt=$((attempt + 1))
    if [[ "$attempt" -ge "$max_attempts" ]]; then
      fail "Timed out waiting for API health endpoint: $health_url"
    fi
    sleep 2
  done

  log "OK" "API health endpoint is reachable: $health_url"
}

configure_api_keys() {
  if [[ "$SKIP_API_KEYS" -eq 1 || "$NON_INTERACTIVE" -eq 1 ]]; then
    return 0
  fi

  if ! confirm "Configure API keys now?" "n"; then
    log "WARN" "Skipping API key setup"
    return 0
  fi

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
}

configure_claude_mcp() {
  if [[ "$SKIP_CLAUDE" -eq 1 ]]; then
    log "WARN" "Skipped Claude Code setup"
    return 0
  fi

  if ! command_exists claude; then
    log "WARN" "Claude CLI not found. Install Claude Code or run npm run mcp:setup later"
    return 0
  fi

  local should_register=0
  local selected_scope="$MCP_SCOPE"

  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    should_register=1
  else
    if [[ "$MCP_SCOPE_EXPLICIT" -eq 0 ]]; then
      selected_scope="$(prompt_mcp_scope)"
    fi

    if confirm "Register MCP server with Claude Code in ${selected_scope} scope?" "y"; then
      should_register=1
    fi
  fi

  if [[ "$should_register" -ne 1 ]]; then
    log "WARN" "Skipped Claude Code MCP registration"
    return 0
  fi

  if [[ "$MCP_SCOPE_EXPLICIT" -eq 0 ]] && claude mcp list 2>/dev/null | grep -q "supermemory"; then
    log "OK" "Claude Code MCP server 'supermemory' already registered"
    return 0
  fi

  if claude mcp add supermemory --scope "$selected_scope" -- node "$REPO_ROOT/dist/mcp/index.js"; then
    log "OK" "Registered MCP server with Claude Code (${selected_scope} scope)"
  else
    log "WARN" "Could not register MCP automatically. Run: npm run mcp:setup"
  fi
}

remove_claude_mcp() {
  if [[ "$SKIP_CLAUDE" -eq 1 ]]; then
    log "WARN" "Skipped Claude Code MCP cleanup"
    return 0
  fi

  if ! command_exists claude; then
    log "WARN" "Claude CLI not found. Skipping Claude MCP cleanup"
    return 0
  fi

  local scope
  for scope in project local user; do
    if claude mcp remove --scope "$scope" supermemory >/dev/null 2>&1; then
      log "OK" "Removed Claude MCP registration in $scope scope"
    else
      log "INFO" "No Claude MCP registration found in $scope scope"
    fi
  done
}

run_migrations_strict() {
  log "INFO" "Running database migrations"
  ./scripts/migrations/run_migrations.sh
}

run_migrations_best_effort() {
  log "INFO" "Attempting database migrations for update"
  if ./scripts/migrations/run_migrations.sh; then
    log "OK" "Migration attempt completed"
  else
    log "WARN" "Migration attempt failed during update. Verify database reachability and rerun ./scripts/migrations/run_migrations.sh"
  fi
}

remove_local_runtime_artifacts_for_update() {
  local path
  for path in node_modules dist; do
    if [[ -e "$path" ]]; then
      rm -rf "$path"
      log "OK" "Removed $path for clean reinstall"
    else
      log "INFO" "$path not present; skipping"
    fi
  done
}

remove_local_install_artifacts() {
  local path
  for path in node_modules dist coverage .env; do
    if [[ -e "$path" ]]; then
      rm -rf "$path"
      log "OK" "Removed $path"
    else
      log "INFO" "$path not present; skipping"
    fi
  done
}

remove_docker_resources() {
  if ! command_exists docker; then
    log "WARN" "Docker not found. Skipping docker resource cleanup"
    return 0
  fi

  if docker compose version >/dev/null 2>&1; then
    if docker compose down --volumes --remove-orphans >/dev/null 2>&1; then
      log "OK" "Removed docker compose services, network, and attached volumes"
    else
      log "WARN" "docker compose down failed; attempting targeted cleanup"
    fi
  else
    log "WARN" "Docker Compose plugin not found. Attempting targeted cleanup"
  fi

  local container
  for container in supermemory-postgres supermemory-redis; do
    if docker rm -f "$container" >/dev/null 2>&1; then
      log "OK" "Removed container $container"
    else
      log "INFO" "Container $container not present"
    fi
  done

  local volume
  for volume in supermemory_postgres_data supermemory_redis_data supermemory-clone_postgres_data supermemory-clone_redis_data; do
    if docker volume inspect "$volume" >/dev/null 2>&1; then
      if docker volume rm "$volume" >/dev/null 2>&1; then
        log "OK" "Removed volume $volume"
      else
        log "WARN" "Could not remove volume $volume (it may still be in use)"
      fi
    else
      log "INFO" "Volume $volume not present"
    fi
  done

  local network
  for network in supermemory-network supermemory-clone_default; do
    if docker network inspect "$network" >/dev/null 2>&1; then
      if docker network rm "$network" >/dev/null 2>&1; then
        log "OK" "Removed network $network"
      else
        log "WARN" "Could not remove network $network (it may still be in use)"
      fi
    else
      log "INFO" "Network $network not present"
    fi
  done

  local image
  for image in pgvector/pgvector:pg16 redis:7-alpine; do
    if docker image inspect "$image" >/dev/null 2>&1; then
      if docker image rm "$image" >/dev/null 2>&1; then
        log "OK" "Removed image $image"
      else
        log "WARN" "Could not remove image $image (it may be shared with other projects)"
      fi
    else
      log "INFO" "Image $image not present"
    fi
  done
}

validate_prerequisites() {
  require_command node
  require_command npm

  if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"; then
    fail "Node.js >= 20 is required"
  fi

  if [[ "$SKIP_DOCKER" -eq 0 ]]; then
    require_command docker
    docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is required"
  fi
}

ensure_env_file() {
  local created_env=0
  if [[ ! -f .env ]]; then
    cp .env.example .env
    created_env=1
    log "OK" "Created .env from .env.example"
  fi

  ensure_env_defaults "$created_env"

  if [[ "$ACTION" == "install" ]]; then
    migrate_legacy_default_ports
  fi
}

run_install_or_update_flow() {
  local mode="$1"

  log "INFO" "Starting Supermemory ${mode} setup"
  validate_prerequisites

  if [[ "$mode" == "update" ]]; then
    log "INFO" "Update mode performs a clean reinstall of app components"
    remove_local_runtime_artifacts_for_update
  fi

  log "INFO" "Installing npm dependencies"
  npm install

  ensure_env_file
  configure_api_keys

  local api_port
  local api_host_port
  local api_started=0
  api_port="$(read_env_value "API_PORT")"
  if [[ -z "$api_port" ]]; then
    api_port="13000"
  fi

  api_host_port="$(read_env_value "API_HOST_PORT")"
  if [[ -z "$api_host_port" ]]; then
    api_host_port="$api_port"
  fi

  if [[ "$SKIP_DOCKER" -eq 0 ]]; then
    if [[ "$SKIP_API_START" -eq 0 ]]; then
      log "INFO" "Starting Docker services: postgres, redis, api"
      start_api_stack
      wait_for_container_health "supermemory-postgres" 120
      wait_for_container_health "supermemory-redis" 60
      verify_api_health "$api_host_port"
      api_started=1
    else
      log "INFO" "Starting Docker services: postgres, redis"
      start_compose_services
      wait_for_container_health "supermemory-postgres" 120
      wait_for_container_health "supermemory-redis" 60
    fi

    if [[ "$mode" == "update" ]]; then
      run_migrations_best_effort
    else
      run_migrations_strict
    fi
  elif [[ "$mode" == "update" ]]; then
    run_migrations_best_effort
  else
    log "WARN" "Skipped Docker startup and migrations"
  fi

  if [[ "$SKIP_BUILD" -eq 0 ]]; then
    log "INFO" "Building project"
    npm run build
  else
    log "WARN" "Skipped project build"
  fi

  configure_claude_mcp

  local connectivity_ok=0
  if npm run doctor; then
    connectivity_ok=1
    log "OK" "Connectivity checks passed"
  else
    log "WARN" "Connectivity checks found issues. Review output above"
  fi

  if [[ "$SKIP_DOCKER" -eq 1 && "$SKIP_API_START" -eq 0 ]]; then
    log "WARN" "--skip-docker prevents API auto-start. Start the stack manually when ready"
  fi

  if [[ "$api_started" -eq 1 ]]; then
    cat <<GUIDE

Setup complete.

Basic usage flow:
  1) Verify health:
       curl http://localhost:${api_host_port}/health
  2) Add a document:
       curl -X POST http://localhost:${api_host_port}/api/v1/documents -H "Content-Type: application/json" -d '{"content":"My first memory"}'
  3) Search:
       curl -X POST http://localhost:${api_host_port}/api/v1/search -H "Content-Type: application/json" -d '{"query":"first memory"}'

If you want to run the API in local watch mode instead of Docker:
  - Stop the API container:
      docker compose stop api
  - Start locally:
      npm run dev
  - Then use:
      curl http://localhost:${api_port}/health
GUIDE
  else
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
GUIDE
  fi

  cat <<GUIDE

If you skipped API keys:
  - Edit .env and set OPENAI_API_KEY and/or ANTHROPIC_API_KEY
  - Then rerun connectivity checks:
      npm run doctor

If you skipped Docker:
  - Start services manually, then run:
      docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api postgres redis
      ./scripts/migrations/run_migrations.sh
      npm run doctor
GUIDE

  if [[ "$connectivity_ok" -ne 1 ]]; then
    exit 1
  fi
}

run_uninstall_flow() {
  log "INFO" "Starting Supermemory uninstall"
  remove_claude_mcp
  remove_docker_resources
  remove_local_install_artifacts
  log "OK" "Uninstall cleanup completed"
}

parse_args() {
  local action_explicit=0

  while [[ "$#" -gt 0 ]]; do
    local arg="$1"
    case "$arg" in
      install|update|uninstall)
        if [[ "$action_explicit" -eq 1 ]]; then
          fail "Only one command is allowed (install, update, or uninstall)"
        fi
        ACTION="$arg"
        action_explicit=1
        ;;
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
      --skip-api-start)
        SKIP_API_START=1
        ;;
      --scope)
        shift
        if [[ "$#" -eq 0 ]]; then
          fail "Missing value for --scope (expected: user, project, or local)"
        fi
        MCP_SCOPE="${1,,}"
        validate_mcp_scope "$MCP_SCOPE"
        MCP_SCOPE_EXPLICIT=1
        ;;
      --scope=*)
        MCP_SCOPE="${arg#*=}"
        MCP_SCOPE="${MCP_SCOPE,,}"
        validate_mcp_scope "$MCP_SCOPE"
        MCP_SCOPE_EXPLICIT=1
        ;;
      --non-interactive)
        NON_INTERACTIVE=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $arg"
        ;;
    esac
    shift
  done
}

main() {
  parse_args "$@"

  case "$ACTION" in
    install)
      run_install_or_update_flow "install"
      ;;
    update)
      run_install_or_update_flow "update"
      ;;
    uninstall)
      run_uninstall_flow
      ;;
    *)
      fail "Unsupported command: $ACTION"
      ;;
  esac
}

main "$@"