#!/usr/bin/env bash
set -euo pipefail

ACTION="install"
MODE="agent"
REGISTER_MCP=0
MCP_SCOPE=""

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    update)
      ACTION="update"
      ;;
    agent|api|full)
      MODE="$1"
      ;;
    --mode)
      shift
      MODE="$1"
      ;;
    --register-mcp)
      REGISTER_MCP=1
      ;;
    --scope)
      shift
      MCP_SCOPE="$1"
      ;;
  esac
  shift
done

mkdir -p "$(pwd)/scripts" "$(pwd)/dist/mcp"

if [[ "$REGISTER_MCP" -eq 1 && "$MCP_SCOPE" == "project" ]]; then
  cat > .mcp.json <<JSON
{
  "mcpServers": {
    "supermemory": {
      "command": "node",
      "args": ["$(pwd)/dist/mcp/index.js"]
    }
  }
}
JSON
fi

if [[ -n "${SUPERMEMORY_INSTALLER_RESULT_FILE:-}" ]]; then
  INSTALL_RESULT_FILE="$SUPERMEMORY_INSTALLER_RESULT_FILE" \
  INSTALL_RESULT_ACTION="$ACTION" \
  INSTALL_RESULT_MODE="$MODE" \
  INSTALL_RESULT_DIR="$(pwd)" \
  INSTALL_RESULT_MCP_SCOPE="$MCP_SCOPE" \
  node <<'NODE'
const { writeFileSync } = require('node:fs')

writeFileSync(
  process.env.INSTALL_RESULT_FILE,
  `${JSON.stringify(
    {
      action: process.env.INSTALL_RESULT_ACTION,
      installMode: process.env.INSTALL_RESULT_MODE,
      installDir: process.env.INSTALL_RESULT_DIR,
      envFile: null,
      apiHostPort: process.env.INSTALL_RESULT_MODE === 'agent' ? null : '13000',
      apiStarted: process.env.INSTALL_RESULT_MODE !== 'agent',
      connectivityOk: true,
      mcp: {
        scope: process.env.INSTALL_RESULT_MCP_SCOPE || null,
        status: process.env.INSTALL_RESULT_MCP_SCOPE ? 'registered' : 'not_requested',
      },
      flags: {
        skipDocker: false,
        skipApiKeys: false,
        skipApiStart: false,
        apiKeysWereSkipped: false,
      },
    },
    null,
    2
  )}\n`
)
NODE
fi
