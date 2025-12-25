#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_DIR="$ROOT_DIR/python"

CHROME_DEBUG_PORT="${CHROME_DEBUG_PORT:-9222}"
CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-$HOME/.browser-agent-chrome-profile}"
CHROME_DEBUG_URL_DEFAULT="http://127.0.0.1:${CHROME_DEBUG_PORT}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd python3
require_cmd pnpm

mkdir -p "$CHROME_PROFILE_DIR"

CHROME_DEBUG_URL="$(grep -E '^CHROME_DEBUG_URL=' "$PY_DIR/.env" | tail -n1 | cut -d= -f2- || true)"
CHROME_DEBUG_URL="${CHROME_DEBUG_URL:-$CHROME_DEBUG_URL_DEFAULT}"
export CHROME_DEBUG_URL

# Start or reuse a persistent Chrome instance for login/session reuse
if ! python3 - <<PY >/dev/null 2>&1
import socket
s=socket.socket();
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", int("$CHROME_DEBUG_PORT")))
finally:
    s.close()
PY
then
  if command -v open >/dev/null 2>&1; then
    echo "Starting Chrome (remote debugging on port $CHROME_DEBUG_PORT)..." >&2
    open -na "Google Chrome" --args \
      "--remote-debugging-port=$CHROME_DEBUG_PORT" \
      "--user-data-dir=$CHROME_PROFILE_DIR" >/dev/null 2>&1 || true
  else
    echo "Cannot start Chrome automatically (missing 'open'). Please start Chrome with remote debugging: $CHROME_DEBUG_URL" >&2
  fi
fi

for _ in $(seq 1 50); do
  if python3 - <<PY >/dev/null 2>&1
import socket
s=socket.socket();
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", int("$CHROME_DEBUG_PORT")))
    print("ok")
finally:
    s.close()
PY
  then
    echo "Chrome remote debugging is up at $CHROME_DEBUG_URL" >&2
    break
  fi
  sleep 0.2
done

if [[ ! -f "$PY_DIR/.env" ]]; then
  if [[ -f "$PY_DIR/.env.example" ]]; then
    cp "$PY_DIR/.env.example" "$PY_DIR/.env"
    echo "Created $PY_DIR/.env from .env.example. Please edit it (OPENAI_API_KEY, etc.)" >&2
  else
    echo "Missing $PY_DIR/.env and $PY_DIR/.env.example" >&2
    exit 1
  fi
fi

VENV_DIR="$PY_DIR/.venv"
if [[ ! -d "$VENV_DIR" ]]; then
  if command -v uv >/dev/null 2>&1; then
    uv venv --python 3.11 "$VENV_DIR"
  else
    python3 -m venv "$VENV_DIR"
  fi
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

if command -v uv >/dev/null 2>&1; then
  uv pip install -r "$PY_DIR/requirements.txt"
else
  pip install -r "$PY_DIR/requirements.txt"
fi

echo "Starting Python backend..." >&2
PYTHONUNBUFFERED=1 python "$PY_DIR/main.py" &
BACKEND_PID=$!

cleanup() {
  if kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

HOST="$(grep -E '^SERVER_HOST=' "$PY_DIR/.env" | tail -n1 | cut -d= -f2- || true)"
PORT="$(grep -E '^SERVER_PORT=' "$PY_DIR/.env" | tail -n1 | cut -d= -f2- || true)"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8765}"

# Wait for backend port
for _ in $(seq 1 50); do
  if python - <<PY >/dev/null 2>&1
import socket
s=socket.socket();
s.settimeout(0.2)
try:
    s.connect(("$HOST", int("$PORT")))
    print("ok")
finally:
    s.close()
PY
  then
    echo "Backend is up at http://$HOST:$PORT" >&2
    break
  fi
  sleep 0.2
done

echo "Starting Electron dev..." >&2
cd "$ROOT_DIR"
pnpm dev:electron
