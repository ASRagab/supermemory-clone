#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

if [[ -d "$HOME/.local/bin" ]]; then
  PATH="$HOME/.local/bin:$PATH"
fi

if [[ -d "/usr/local/bin" ]]; then
  PATH="/usr/local/bin:$PATH"
fi

ACTION="install"
INSTALL_MODE="agent"
ENV_FILE=""
PURGE=0
SKIP_DOCKER=0
SKIP_API_KEYS=0
SKIP_CLAUDE=0
REGISTER_MCP=0
NON_INTERACTIVE=0
SKIP_BUILD=0
SKIP_API_START=0
MCP_SCOPE="user"
MCP_SCOPE_EXPLICIT=0
INSTALLER_BRIEF="${SUPERMEMORY_INSTALLER_BRIEF:-0}"
INSTALLER_RESULT_FILE="${SUPERMEMORY_INSTALLER_RESULT_FILE:-}"
CLAUDE_MCP_STATUS="not_requested"
CLAUDE_MCP_SCOPE_USED=""
API_KEYS_WERE_SKIPPED=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/install.sh [command] [options]

Commands:
  install               Install or repair local setup (default, uses --mode agent unless overridden)
  update                Reinstall app components, preserve Postgres/Redis data, and attempt DB migrations
  uninstall             Remove generated local artifacts and stop project services
  agent                 Shorthand for: install --mode agent
  api                   Shorthand for: install --mode api
  full                  Shorthand for: install --mode full

Options:
  --mode <mode>         Install/update mode: agent (default), api, or full
  --env-file <path>     Env file to use (default precedence: SUPERMEMORY_ENV_FILE, .env.local, .env)
  --skip-docker         Skip docker startup (install/update only)
  --skip-api-keys       Do not prompt for API keys (install/update only)
  --register-mcp        Explicitly register Claude Code MCP integration
  --skip-mcp            Skip Claude Code MCP registration/removal
  --skip-claude         Alias for --skip-mcp
  --purge               With uninstall, also remove env files, Docker volumes, and Claude MCP registrations
  --skip-build          Skip npm run build (install/update only)
  --skip-api-start      Skip auto-starting the API container after install/update in api/full mode
  --scope <scope>       MCP scope override: user (default), project, or local
  --non-interactive     Use defaults and avoid prompts
  -h, --help            Show this help

Examples:
  ./scripts/install.sh
  ./scripts/install.sh agent
  ./scripts/install.sh install --mode api
  ./scripts/install.sh agent --env-file /tmp/supermemory.env
  ./scripts/install.sh update --skip-claude
  ./scripts/install.sh agent --non-interactive --register-mcp --scope project
  ./scripts/install.sh full --skip-api-start
  ./scripts/install.sh --scope project
  ./scripts/install.sh uninstall --non-interactive
  ./scripts/install.sh uninstall --purge --non-interactive
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

validate_install_mode() {
  local mode="$1"
  case "$mode" in
    agent|api|full)
      return 0
      ;;
    *)
      fail "Invalid install mode: $mode (expected: agent, api, or full)"
      ;;
  esac
}

resolve_path() {
  local candidate="$1"
  if [[ "$candidate" = /* ]]; then
    printf '%s\n' "$candidate"
  else
    printf '%s\n' "$REPO_ROOT/$candidate"
  fi
}

resolve_default_env_file() {
  if [[ -n "${SUPERMEMORY_ENV_FILE:-}" ]]; then
    resolve_path "$SUPERMEMORY_ENV_FILE"
    return 0
  fi

  if [[ -f "$REPO_ROOT/.env.local" ]]; then
    printf '%s\n' "$REPO_ROOT/.env.local"
    return 0
  fi

  printf '%s\n' "$REPO_ROOT/.env"
}

ensure_env_file_path() {
  if [[ -n "$ENV_FILE" ]]; then
    ENV_FILE="$(resolve_path "$ENV_FILE")"
  else
    ENV_FILE="$(resolve_default_env_file)"
  fi

  export SUPERMEMORY_ENV_FILE="$ENV_FILE"
}

compose_cmd() {
  local -a cmd=(docker compose)
  if [[ -f "$ENV_FILE" ]]; then
    cmd+=(--env-file "$ENV_FILE")
  fi
  "${cmd[@]}" "$@"
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
  local file="$ENV_FILE"
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

generate_local_secret() {
  node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
}

scrub_placeholder_env_values() {
  local openai_key
  local anthropic_key
  local llm_provider

  openai_key="$(read_env_value "OPENAI_API_KEY")"
  anthropic_key="$(read_env_value "ANTHROPIC_API_KEY")"
  llm_provider="$(read_env_value "LLM_PROVIDER")"

  if [[ "$openai_key" == "sk-your-openai-api-key-here" ]]; then
    set_env_value "OPENAI_API_KEY" ""
    openai_key=""
  fi

  if [[ "$anthropic_key" == "anthropic-your-api-key-here" ]]; then
    set_env_value "ANTHROPIC_API_KEY" ""
    anthropic_key=""
  fi

  if [[ -z "$openai_key" && -z "$anthropic_key" ]]; then
    if [[ "$llm_provider" == "openai" || "$llm_provider" == "anthropic" ]]; then
      set_env_value "LLM_PROVIDER" ""
    fi

    if [[ "$(read_env_value "LLM_MODEL")" == "gpt-5.1-nano" || "$(read_env_value "LLM_MODEL")" == "claude-4-5-haiku-20251001" ]]; then
      set_env_value "LLM_MODEL" ""
    fi
  fi
}

ensure_env_defaults() {
  local created_env="$1"
  local csrf_secret

  if [[ "$created_env" -eq 1 ]]; then
    set_env_value "DATABASE_URL" "postgresql://supermemory:supermemory_secret@localhost:15432/supermemory"
    set_env_value "REDIS_URL" "redis://localhost:16379"
    set_env_value "API_PORT" "13000"
    set_env_value "API_HOST_PORT" "13000"
    set_env_value "POSTGRES_HOST_PORT" "15432"
    set_env_value "REDIS_HOST_PORT" "16379"
    set_env_value "CSRF_SECRET" "$(generate_local_secret)"
    return
  fi

  if ! grep -q "^API_HOST_PORT=" "$ENV_FILE"; then
    set_env_value "API_HOST_PORT" "13000"
  fi

  if ! grep -q "^POSTGRES_HOST_PORT=" "$ENV_FILE"; then
    set_env_value "POSTGRES_HOST_PORT" "15432"
  fi

  if ! grep -q "^REDIS_HOST_PORT=" "$ENV_FILE"; then
    set_env_value "REDIS_HOST_PORT" "16379"
  fi

  csrf_secret="$(read_env_value "CSRF_SECRET")"
  if [[ -z "$csrf_secret" ]]; then
    set_env_value "CSRF_SECRET" "$(generate_local_secret)"
  fi
}

read_env_value() {
  local key="$1"
  awk -F= -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1) }' "$ENV_FILE" | tail -n 1
}

migrate_legacy_default_ports() {
  if grep -q "^DATABASE_URL=postgresql://supermemory:supermemory_secret@localhost:5432/supermemory$" "$ENV_FILE"; then
    set_env_value "DATABASE_URL" "postgresql://supermemory:supermemory_secret@localhost:15432/supermemory"
    log "INFO" "Updated DATABASE_URL from localhost:5432 to localhost:15432"
  fi

  if grep -q "^REDIS_URL=redis://localhost:6379$" "$ENV_FILE"; then
    set_env_value "REDIS_URL" "redis://localhost:16379"
    log "INFO" "Updated REDIS_URL from localhost:6379 to localhost:16379"
  fi

  if grep -q "^API_PORT=3000$" "$ENV_FILE"; then
    set_env_value "API_PORT" "13000"
    log "INFO" "Updated API_PORT from 3000 to 13000"
  fi
}

load_env_file_into_shell() {
  if [[ ! -f "$ENV_FILE" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
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
  if compose_cmd up -d postgres redis; then
    return 0
  fi

  log "WARN" "docker compose up failed, attempting one cleanup+retry"
  compose_cmd down >/dev/null 2>&1 || true
  docker rm -f supermemory-postgres supermemory-redis >/dev/null 2>&1 || true
  docker network rm supermemory-network >/dev/null 2>&1 || true

  compose_cmd up -d postgres redis
}

start_postgres_service() {
  if compose_cmd up -d postgres; then
    return 0
  fi

  log "WARN" "docker compose up postgres failed, attempting one cleanup+retry"
  compose_cmd down >/dev/null 2>&1 || true
  docker rm -f supermemory-postgres >/dev/null 2>&1 || true
  docker network rm supermemory-network >/dev/null 2>&1 || true

  compose_cmd up -d postgres
}

start_api_stack() {
  if compose_cmd -f docker-compose.yml -f docker-compose.prod.yml --profile production up -d api postgres redis; then
    return 0
  fi

  log "WARN" "docker compose (api stack) up failed, attempting one cleanup+retry"
  compose_cmd -f docker-compose.yml -f docker-compose.prod.yml down >/dev/null 2>&1 || true
  docker rm -f supermemory-api supermemory-postgres supermemory-redis >/dev/null 2>&1 || true
  docker network rm supermemory-network >/dev/null 2>&1 || true

  compose_cmd -f docker-compose.yml -f docker-compose.prod.yml --profile production up -d api postgres redis
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
    API_KEYS_WERE_SKIPPED=1
    return 0
  fi

  if ! confirm "Configure API keys now?" "n"; then
    API_KEYS_WERE_SKIPPED=1
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

  log "OK" "Saved API key/provider configuration to $ENV_FILE"
}

configure_claude_mcp() {
  if [[ "$SKIP_CLAUDE" -eq 1 ]]; then
    CLAUDE_MCP_STATUS="skipped"
    log "WARN" "Skipped Claude Code setup"
    return 0
  fi

  if ! command_exists claude; then
    CLAUDE_MCP_STATUS="missing_cli"
    log "WARN" "Claude CLI not found. Install Claude Code or run npm run mcp:setup later"
    return 0
  fi

  local should_register=0
  local selected_scope="$MCP_SCOPE"
  CLAUDE_MCP_SCOPE_USED="$selected_scope"
  local register_command
  printf -v register_command 'claude mcp add supermemory --scope %q -- node %q' "$selected_scope" "$REPO_ROOT/dist/mcp/index.js"

  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    if [[ "$REGISTER_MCP" -eq 1 || "$MCP_SCOPE_EXPLICIT" -eq 1 ]]; then
      should_register=1
    else
      CLAUDE_MCP_STATUS="not_requested"
      log "INFO" "Skipped Claude Code MCP registration in non-interactive mode. Pass --register-mcp or --scope to opt in"
      return 0
    fi
  else
    if [[ "$MCP_SCOPE_EXPLICIT" -eq 0 ]]; then
      selected_scope="$(prompt_mcp_scope)"
      CLAUDE_MCP_SCOPE_USED="$selected_scope"
      printf -v register_command 'claude mcp add supermemory --scope %q -- node %q' "$selected_scope" "$REPO_ROOT/dist/mcp/index.js"
    fi

    if [[ "$REGISTER_MCP" -eq 1 ]] || confirm "Register MCP server with Claude Code in ${selected_scope} scope?" "y"; then
      should_register=1
    fi
  fi

  if [[ "$should_register" -ne 1 ]]; then
    CLAUDE_MCP_STATUS="declined"
    log "WARN" "Skipped Claude Code MCP registration"
    return 0
  fi

  if npx tsx scripts/claude-mcp-config.ts check --scope "$selected_scope" --name supermemory --command node --arg "$REPO_ROOT/dist/mcp/index.js" --project-dir "$REPO_ROOT" >/dev/null 2>&1; then
    CLAUDE_MCP_STATUS="match"
    log "OK" "Claude Code MCP server 'supermemory' already matches ${selected_scope} scope and command path"
    return 0
  else
    local inspect_rc=$?
    local repair_required=0
    case "$inspect_rc" in
      10)
        log "INFO" "No Claude Code MCP registration found in ${selected_scope} scope"
        ;;
      11)
        log "INFO" "Existing Claude Code MCP registration in ${selected_scope} scope does not match the current command path"
        repair_required=1
        ;;
      *)
        log "WARN" "Could not inspect existing Claude Code MCP registration cleanly. Continuing with registration attempt"
        ;;
    esac

    if [[ "$repair_required" -eq 1 ]]; then
      local remove_command
      printf -v remove_command 'claude mcp remove --scope %q supermemory' "$selected_scope"
      log "INFO" "Removing stale Claude Code MCP registration with: $remove_command"
      if ! claude mcp remove --scope "$selected_scope" supermemory; then
        CLAUDE_MCP_STATUS="remove_failed"
        log "WARN" "Could not remove existing Claude Code MCP registration in ${selected_scope} scope"
        return 0
      fi
    fi
  fi

  log "INFO" "Registering Claude Code MCP server with: $register_command"
  if claude mcp add supermemory --scope "$selected_scope" -- node "$REPO_ROOT/dist/mcp/index.js"; then
    CLAUDE_MCP_STATUS="registered"
    log "OK" "Registered MCP server with Claude Code (${selected_scope} scope)"
  else
    CLAUDE_MCP_STATUS="register_failed"
    log "WARN" "Could not register MCP automatically. Run: npm run mcp:setup"
  fi
}

write_install_result() {
  local api_started="$1"
  local api_host_port="$2"
  local connectivity_ok="$3"

  if [[ -z "$INSTALLER_RESULT_FILE" ]]; then
    return 0
  fi

  INSTALL_RESULT_FILE="$INSTALLER_RESULT_FILE" \
  INSTALL_RESULT_ACTION="$ACTION" \
  INSTALL_RESULT_MODE="$INSTALL_MODE" \
  INSTALL_RESULT_DIR="$REPO_ROOT" \
  INSTALL_RESULT_ENV_FILE="$ENV_FILE" \
  INSTALL_RESULT_API_HOST_PORT="$api_host_port" \
  INSTALL_RESULT_API_STARTED="$api_started" \
  INSTALL_RESULT_CONNECTIVITY_OK="$connectivity_ok" \
  INSTALL_RESULT_MCP_SCOPE="$CLAUDE_MCP_SCOPE_USED" \
  INSTALL_RESULT_MCP_STATUS="$CLAUDE_MCP_STATUS" \
  INSTALL_RESULT_SKIP_DOCKER="$SKIP_DOCKER" \
  INSTALL_RESULT_SKIP_API_KEYS="$SKIP_API_KEYS" \
  INSTALL_RESULT_SKIP_API_START="$SKIP_API_START" \
  INSTALL_RESULT_API_KEYS_WERE_SKIPPED="$API_KEYS_WERE_SKIPPED" \
  node <<'NODE'
const { writeFileSync } = require('node:fs')

const resultPath = process.env.INSTALL_RESULT_FILE
if (!resultPath) {
  process.exit(0)
}

const asBoolean = (value) => value === '1'
const nullableString = (value) => (value ? value : null)

writeFileSync(
  resultPath,
  `${JSON.stringify(
    {
      action: process.env.INSTALL_RESULT_ACTION,
      installMode: process.env.INSTALL_RESULT_MODE,
      installDir: process.env.INSTALL_RESULT_DIR,
      envFile: process.env.INSTALL_RESULT_ENV_FILE,
      apiHostPort: nullableString(process.env.INSTALL_RESULT_API_HOST_PORT),
      apiStarted: asBoolean(process.env.INSTALL_RESULT_API_STARTED),
      connectivityOk: asBoolean(process.env.INSTALL_RESULT_CONNECTIVITY_OK),
      mcp: {
        scope: nullableString(process.env.INSTALL_RESULT_MCP_SCOPE),
        status: process.env.INSTALL_RESULT_MCP_STATUS,
      },
      flags: {
        skipDocker: asBoolean(process.env.INSTALL_RESULT_SKIP_DOCKER),
        skipApiKeys: asBoolean(process.env.INSTALL_RESULT_SKIP_API_KEYS),
        skipApiStart: asBoolean(process.env.INSTALL_RESULT_SKIP_API_START),
        apiKeysWereSkipped: asBoolean(process.env.INSTALL_RESULT_API_KEYS_WERE_SKIPPED),
      },
    },
    null,
    2
  )}\n`
)
NODE
}

print_install_summary() {
  local api_started="$1"
  local api_host_port="$2"
  local connectivity_ok="$3"
  local step=1

  if [[ "$INSTALLER_BRIEF" == "1" ]]; then
    return 0
  fi

  printf '\nInstall complete.\n'
  printf '\nNext:\n'

  if [[ "$INSTALL_MODE" == "api" || "$INSTALL_MODE" == "full" ]]; then
    if [[ "$api_started" -eq 1 && -n "$api_host_port" ]]; then
      printf '  %d. Verify the API: curl http://localhost:%s/health\n' "$step" "$api_host_port"
      step=$((step + 1))
    elif [[ "$SKIP_API_START" -eq 1 ]]; then
      printf '  %d. Start the API stack when ready: docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile production up -d api postgres redis\n' "$step"
      step=$((step + 1))
    fi
  fi

  if [[ "$INSTALL_MODE" == "agent" || "$INSTALL_MODE" == "full" ]]; then
    case "$CLAUDE_MCP_STATUS" in
      registered|match)
        if [[ "$CLAUDE_MCP_SCOPE_USED" == "project" ]]; then
          printf '  %d. Open Claude in this directory\n' "$step"
        else
          printf '  %d. Open Claude and use supermemory_add\n' "$step"
        fi
        step=$((step + 1))
        ;;
      *)
        printf '  %d. Register Claude later with: npm run mcp:setup -- --scope project --non-interactive --register-mcp\n' "$step"
        step=$((step + 1))
        ;;
    esac
  fi

  if [[ "$INSTALL_MODE" == "full" && "$CLAUDE_MCP_SCOPE_USED" == "project" ]]; then
    if [[ "$CLAUDE_MCP_STATUS" == "registered" || "$CLAUDE_MCP_STATUS" == "match" ]]; then
      printf '  %d. Ask Claude to use supermemory_add\n' "$step"
    fi
  fi

  if [[ "$SKIP_API_KEYS" -eq 1 ]]; then
    printf '\nAPI keys were skipped, so extraction quality may be limited until you update %s.\n' "$ENV_FILE"
  fi

  if [[ "$SKIP_DOCKER" -eq 1 ]]; then
    printf '\nDocker startup was skipped, so start services manually before using the installed surfaces.\n'
  fi

  if [[ "$connectivity_ok" -ne 1 ]]; then
    printf '\nConnectivity checks found issues. Review the logs above.\n'
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
  load_env_file_into_shell
  ./scripts/migrations/run_migrations.sh
}

run_migrations_best_effort() {
  log "INFO" "Attempting database migrations for update"
  load_env_file_into_shell
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
  for path in node_modules dist coverage; do
    if [[ -e "$path" ]]; then
      rm -rf "$path"
      log "OK" "Removed $path"
    else
      log "INFO" "$path not present; skipping"
    fi
  done
}

trash_user_owned_path() {
  local path="$1"

  if [[ ! -e "$path" ]]; then
    log "INFO" "$path not present; skipping"
    return 0
  fi

  if command_exists trash; then
    trash "$path"
    log "OK" "Moved $path to trash"
  else
    rm -rf "$path"
    log "OK" "Removed $path"
  fi
}

remove_user_env_files() {
  local candidate
  local -a paths_to_remove=()

  if [[ -n "$ENV_FILE" ]]; then
    paths_to_remove+=("$ENV_FILE")
  fi

  paths_to_remove+=("$REPO_ROOT/.env" "$REPO_ROOT/.env.local")

  declare -A seen=()
  for candidate in "${paths_to_remove[@]}"; do
    if [[ -n "$candidate" && -z "${seen[$candidate]+x}" ]]; then
      seen[$candidate]=1
      trash_user_owned_path "$candidate"
    fi
  done
}

stop_docker_services() {
  if ! command_exists docker; then
    log "WARN" "Docker not found. Skipping docker service shutdown"
    return 0
  fi

  if docker compose version >/dev/null 2>&1; then
    compose_cmd -f docker-compose.yml -f docker-compose.prod.yml stop api postgres redis >/dev/null 2>&1 || true
    compose_cmd stop postgres redis >/dev/null 2>&1 || true
  else
    log "WARN" "Docker Compose plugin not found. Attempting targeted container stop"
  fi

  local container
  for container in supermemory-api supermemory-postgres supermemory-redis; do
    if docker stop "$container" >/dev/null 2>&1; then
      log "OK" "Stopped container $container"
    else
      log "INFO" "Container $container not present"
    fi
  done
}

purge_docker_resources() {
  if ! command_exists docker; then
    log "WARN" "Docker not found. Skipping docker purge"
    return 0
  fi

  if docker compose version >/dev/null 2>&1; then
    if compose_cmd -f docker-compose.yml -f docker-compose.prod.yml down --volumes --remove-orphans >/dev/null 2>&1; then
      log "OK" "Removed docker compose services, network, and attached volumes"
    else
      log "WARN" "docker compose down failed; attempting targeted purge"
    fi
  else
    log "WARN" "Docker Compose plugin not found. Attempting targeted purge"
  fi

  local container
  for container in supermemory-api supermemory-postgres supermemory-redis; do
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
  mkdir -p "$(dirname "$ENV_FILE")"

  if [[ ! -f "$ENV_FILE" ]]; then
    cp .env.example "$ENV_FILE"
    created_env=1
    log "OK" "Created $ENV_FILE from .env.example"
  fi

  ensure_env_defaults "$created_env"
  scrub_placeholder_env_values
  load_env_file_into_shell

  if [[ "$ACTION" == "install" ]]; then
    migrate_legacy_default_ports
  fi
}

run_install_or_update_flow() {
  local action="$1"

  log "INFO" "Starting Supermemory ${action} setup (${INSTALL_MODE} mode)"
  validate_prerequisites

  if [[ "$action" == "update" ]]; then
    log "INFO" "Update mode performs a clean reinstall of app components"
    remove_local_runtime_artifacts_for_update
  fi

  log "INFO" "Installing npm dependencies"
  npm install

  ensure_env_file
  configure_api_keys
  load_env_file_into_shell

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
    case "$INSTALL_MODE" in
      agent)
        log "INFO" "Starting Docker services: postgres"
        start_postgres_service
        wait_for_container_health "supermemory-postgres" 120
        ;;
      api|full)
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
        ;;
    esac

    if [[ "$action" == "update" ]]; then
      run_migrations_best_effort
    else
      run_migrations_strict
    fi
  elif [[ "$action" == "update" ]]; then
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
  if npm run doctor -- --env-file "$ENV_FILE" --mode "$INSTALL_MODE"; then
    connectivity_ok=1
    log "OK" "Connectivity checks passed"
  else
    log "WARN" "Connectivity checks found issues. Review output above"
  fi

  if [[ "$SKIP_DOCKER" -eq 1 ]]; then
    case "$INSTALL_MODE" in
      agent)
        log "WARN" "--skip-docker prevents Postgres startup. Start Postgres manually before using MCP or the API"
        ;;
      api|full)
        if [[ "$SKIP_API_START" -eq 0 ]]; then
          log "WARN" "--skip-docker prevents API auto-start. Start the stack manually when ready"
        fi
        ;;
    esac
  fi

  write_install_result "$api_started" "$api_host_port" "$connectivity_ok"
  print_install_summary "$api_started" "$api_host_port" "$connectivity_ok"

  if [[ "$connectivity_ok" -ne 1 ]]; then
    exit 1
  fi
}

run_uninstall_flow() {
  if [[ "$PURGE" -eq 1 ]]; then
    log "INFO" "Starting Supermemory uninstall with purge"
  else
    log "INFO" "Starting Supermemory uninstall"
  fi

  stop_docker_services
  remove_local_install_artifacts

  if [[ "$PURGE" -eq 1 ]]; then
    remove_claude_mcp
    purge_docker_resources
    remove_user_env_files
    log "OK" "Uninstall purge completed"
  else
    log "INFO" "Preserved env files, Docker volumes, and Claude MCP registrations. Re-run with uninstall --purge to remove them"
    log "OK" "Uninstall cleanup completed"
  fi
}

parse_args() {
  local action_explicit=0
  local install_mode_explicit=0

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
      agent|api|full)
        if [[ "$action_explicit" -eq 0 ]]; then
          ACTION="install"
          action_explicit=1
        elif [[ "$ACTION" != "install" && "$ACTION" != "update" ]]; then
          fail "Install modes can only be used with install or update"
        fi

        if [[ "$install_mode_explicit" -eq 1 ]]; then
          fail "Only one install mode is allowed (agent, api, or full)"
        fi

        INSTALL_MODE="$arg"
        install_mode_explicit=1
        ;;
      --mode)
        shift
        if [[ "$#" -eq 0 ]]; then
          fail "Missing value for --mode (expected: agent, api, or full)"
        fi
        INSTALL_MODE="${1,,}"
        validate_install_mode "$INSTALL_MODE"
        install_mode_explicit=1
        ;;
      --mode=*)
        INSTALL_MODE="${arg#*=}"
        INSTALL_MODE="${INSTALL_MODE,,}"
        validate_install_mode "$INSTALL_MODE"
        install_mode_explicit=1
        ;;
      --env-file)
        shift
        if [[ "$#" -eq 0 ]]; then
          fail "Missing value for --env-file"
        fi
        ENV_FILE="$1"
        ;;
      --env-file=*)
        ENV_FILE="${arg#*=}"
        ;;
      --skip-docker)
        SKIP_DOCKER=1
        ;;
      --skip-api-keys)
        SKIP_API_KEYS=1
        ;;
      --register-mcp)
        REGISTER_MCP=1
        ;;
      --skip-mcp|--skip-claude)
        SKIP_CLAUDE=1
        ;;
      --skip-build)
        SKIP_BUILD=1
        ;;
      --purge)
        PURGE=1
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
  ensure_env_file_path
  validate_install_mode "$INSTALL_MODE"

  if [[ "$PURGE" -eq 1 && "$ACTION" != "uninstall" ]]; then
    fail "--purge is only supported with uninstall"
  fi

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
