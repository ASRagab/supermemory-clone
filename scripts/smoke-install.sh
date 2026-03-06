#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${1:-./supermemory-smoke}"
INSTALLER_VERSION="${SUPERMEMORY_INSTALLER_VERSION:-latest}"
RUNTIME_VERSION="${SUPERMEMORY_RUNTIME_VERSION:-latest}"

npx -y "@supermemory/install@${INSTALLER_VERSION}" full \
  --dir "$TARGET_DIR" \
  --mcp project \
  --runtime-version "$RUNTIME_VERSION" \
  --skip-api-keys
