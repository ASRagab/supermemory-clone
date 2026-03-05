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
  --repo-url URL         Git repository URL
  --ref REF              Git branch/tag/sha to checkout
  --dir DIR              Install directory (default: supermemory-clone)
  --update-if-exists     Update an existing compatible checkout in place
  -h, --help             Show this help

Examples:
  bootstrap.sh
  bootstrap.sh --repo-url https://github.com/acme/supermemory-clone.git
  bootstrap.sh --dir ./supermemory -- --non-interactive --skip-api-keys
  bootstrap.sh --dir ./supermemory --update-if-exists -- --non-interactive --skip-mcp
USAGE
}

repo_url="${REPO_URL:-https://github.com/ASRagab/supermemory-clone.git}"
install_ref="${INSTALL_REF:-}"
install_dir="${INSTALL_DIR:-supermemory-clone}"
update_if_exists=0
temp_clone_dir=""
declare -a install_args=()

cleanup() {
  if [[ -n "$temp_clone_dir" && -d "$temp_clone_dir" ]]; then
    rm -rf "$temp_clone_dir"
  fi
}

trap cleanup EXIT

run_installer() {
  local target_dir="$1"
  shift || true
  (
    cd "$target_dir"
    bash ./scripts/install.sh "$@"
  )
}

checkout_requested_ref() {
  local target_dir="$1"

  if [[ -z "$install_ref" ]]; then
    return 0
  fi

  log "INFO" "Fetching requested ref: $install_ref"
  git -C "$target_dir" fetch --depth 1 origin "$install_ref"
  log "INFO" "Checking out ref: $install_ref"
  git -C "$target_dir" checkout FETCH_HEAD
}

clone_into_temp_dir() {
  local parent_dir="$1"
  mkdir -p "$parent_dir"
  temp_clone_dir="$(mktemp -d "${parent_dir%/}/.supermemory-bootstrap.XXXXXX")"

  log "INFO" "Cloning repository: $repo_url"
  git clone --depth 1 "$repo_url" "$temp_clone_dir"
  checkout_requested_ref "$temp_clone_dir"
}

ensure_compatible_checkout() {
  local target_dir="$1"

  if ! git -C "$target_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "--update-if-exists requires an existing git checkout: $target_dir"
  fi

  if [[ ! -f "$target_dir/scripts/install.sh" ]]; then
    fail "--update-if-exists requires a compatible checkout with scripts/install.sh: $target_dir"
  fi

  if ! git -C "$target_dir" diff --quiet --ignore-submodules -- || ! git -C "$target_dir" diff --cached --quiet --ignore-submodules --; then
    fail "--update-if-exists cannot run on a checkout with uncommitted tracked changes: $target_dir"
  fi
}

update_existing_checkout() {
  local target_dir="$1"
  local current_branch
  local -a effective_args=()

  ensure_compatible_checkout "$target_dir"

  if [[ -n "$install_ref" ]]; then
    checkout_requested_ref "$target_dir"
  else
    current_branch="$(git -C "$target_dir" symbolic-ref --quiet --short HEAD || true)"
    if [[ -z "$current_branch" ]]; then
      fail "--update-if-exists on a detached HEAD requires --ref"
    fi

    log "INFO" "Fast-forwarding existing checkout"
    git -C "$target_dir" pull --ff-only origin "$current_branch"
  fi

  if [[ "${#install_args[@]}" -eq 0 ]]; then
    effective_args=(update)
  else
    case "${install_args[0]}" in
      install|update|uninstall)
        effective_args=("${install_args[@]}")
        ;;
      agent|api|full)
        effective_args=(update --mode "${install_args[0]}" "${install_args[@]:1}")
        ;;
      *)
        effective_args=(update "${install_args[@]}")
        ;;
    esac
  fi

  log "INFO" "Running installer against existing checkout"
  run_installer "$target_dir" "${effective_args[@]}"
}

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
    --update-if-exists)
      update_if_exists=1
      shift
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
  if [[ "$update_if_exists" -ne 1 ]]; then
    fail "Install directory already exists: $install_dir (use --update-if-exists to reuse a compatible checkout)"
  fi
else
  if [[ "$update_if_exists" -eq 1 ]]; then
    fail "--update-if-exists requires an existing install directory: $install_dir"
  fi
fi

if [[ "$update_if_exists" -eq 1 ]]; then
  update_existing_checkout "$install_dir"
else
  clone_into_temp_dir "$(dirname "$install_dir")"

  log "INFO" "Running turnkey installer"
  run_installer "$temp_clone_dir" "${install_args[@]}"

  log "INFO" "Moving installed checkout into place: $install_dir"
  mv "$temp_clone_dir" "$install_dir"
  temp_clone_dir=""
fi

log "OK" "Bootstrap complete"
