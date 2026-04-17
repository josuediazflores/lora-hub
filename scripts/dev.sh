#!/usr/bin/env bash
# Dev stack launcher for LoRA Hub.
#
# Runs, in order:
#   1. Re-initialises the local D1 database (schema.sql + seed.sql) via wrangler.
#   2. Starts the storefront worker in the background (logs to $LOG_DIR).
#   3. Waits for it to accept requests on http://localhost:8787.
#   4. Launches the Tauri desktop app in the foreground.
#
# Ctrl+C the Tauri window (or this terminal) → storefront is stopped too.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STOREFRONT_DIR="$REPO_ROOT/storefront"
DESKTOP_DIR="$REPO_ROOT/apps/desktop"
SIDECAR_PY="$REPO_ROOT/sidecar/.venv/bin/python"

LOG_DIR="${TMPDIR:-/tmp}"
STOREFRONT_LOG="${LOG_DIR%/}/lora-hub-storefront.log"

STOREFRONT_PORT=8787
WAIT_SECONDS=30

blue()  { printf "\033[34m▸ %s\033[0m\n" "$*"; }
green() { printf "\033[32m✓ %s\033[0m\n" "$*"; }
red()   { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }

storefront_pid=""
cleanup() {
  if [ -n "$storefront_pid" ] && kill -0 "$storefront_pid" 2>/dev/null; then
    echo
    blue "stopping storefront (pid $storefront_pid)"
    kill "$storefront_pid" 2>/dev/null || true
    wait "$storefront_pid" 2>/dev/null || true
    green "stopped"
  fi
}
trap cleanup EXIT INT TERM

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# --- Preflight ---------------------------------------------------------------

if [ ! -x "$SIDECAR_PY" ]; then
  red "sidecar venv not found at $SIDECAR_PY"
  echo "  create it with:" >&2
  echo "    python3 -m venv sidecar/.venv && \\" >&2
  echo "    sidecar/.venv/bin/pip install -r sidecar/requirements.txt" >&2
  exit 1
fi

if lsof -i ":$STOREFRONT_PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  red "port $STOREFRONT_PORT is already in use"
  echo "  another storefront (or dev server) is running. Stop it first:" >&2
  echo "    lsof -i :$STOREFRONT_PORT -sTCP:LISTEN" >&2
  exit 1
fi

# --- 1. Reset local D1 -------------------------------------------------------

blue "resetting local D1 (schema + seed)"
( cd "$STOREFRONT_DIR" && npm run --silent db:reset:local )
green "D1 reset"

# --- 2. Start storefront in background --------------------------------------

blue "starting storefront (wrangler dev) — logs: $STOREFRONT_LOG"
: > "$STOREFRONT_LOG"
( cd "$STOREFRONT_DIR" && npm run --silent dev ) >"$STOREFRONT_LOG" 2>&1 &
storefront_pid=$!

# --- 3. Wait for /bases endpoint ---------------------------------------------

blue "waiting for http://localhost:$STOREFRONT_PORT/bases (up to ${WAIT_SECONDS}s)"
ready=0
for _ in $(seq 1 "$WAIT_SECONDS"); do
  if ! kill -0 "$storefront_pid" 2>/dev/null; then
    red "storefront crashed — last 40 log lines:"
    tail -40 "$STOREFRONT_LOG" >&2 || true
    exit 1
  fi
  if curl -fsS "http://localhost:$STOREFRONT_PORT/bases" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  red "storefront didn't come up in ${WAIT_SECONDS}s — last 40 log lines:"
  tail -40 "$STOREFRONT_LOG" >&2 || true
  exit 1
fi
green "storefront ready on :$STOREFRONT_PORT"

# --- 4. Tauri dev in foreground ---------------------------------------------

blue "starting Tauri dev app (Ctrl+C here to stop everything)"
cd "$DESKTOP_DIR"
npm run tauri dev
