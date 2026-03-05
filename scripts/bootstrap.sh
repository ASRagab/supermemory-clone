#!/usr/bin/env bash
set -euo pipefail

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

usage() {
  cat <<'USAGE'
Usage: bootstrap.sh [options] [-- <install.sh args>]

Options:
  --repo-url URL   Git repository URL
  --ref REF        Git branch/tag/sha to checkout
  --dir DIR        Install directory (default: supermemory-clone)
  -h, --help       Show this help

Examples:
  bootstrap.sh
  bootstrap.sh --repo-url https://github.com/acme/supermemory-clone.git
  bootstrap.sh --dir ./supermemory -- --non-interactive --skip-api-keys
USAGE
}

repo_url="${REPO_URL:-https://github.com/ASRagab/supermemory-clone.git}"
install_ref="${INSTALL_REF:-}"
install_dir="${INSTALL_DIR:-supermemory-clone}"
declare -a install_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      [[ $# -lt 2 ]] && fail "--repo-url requires a value"
      repo_url="$2"
      shift 2
      ;;
    --ref)
      [[ $# -lt 2 ]] && fail "--ref requires a value"
      install_ref="$2"
      shift 2
      ;;
    --dir)
      [[ $# -lt 2 ]] && fail "--dir requires a value"
      install_dir="$2"
      shift 2
      ;;
    --)
      shift
      install_args=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

require_command git
require_command bash

if [[ -e "$install_dir" ]]; then
  fail "Install directory already exists: $install_dir"
fi

log "INFO" "Cloning repository: $repo_url"
git clone "$repo_url" "$install_dir"

if [[ -n "$install_ref" ]]; then
  log "INFO" "Checking out ref: $install_ref"
  git -C "$install_dir" checkout "$install_ref"
fi

log "INFO" "Running turnkey installer"
(
  cd "$install_dir"
  bash ./scripts/install.sh "${install_args[@]}"
)

log "OK" "Bootstrap complete"
