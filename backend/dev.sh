#!/usr/bin/env bash
# Run the API locally with auto-reload: ./backend/dev.sh
# Extra arguments pass through to uvicorn, e.g. ./backend/dev.sh --port 9000
set -euo pipefail

# .venv and .env live at the repo root, so run from there wherever this is invoked.
cd "$(dirname "$0")/.."

# nothing in backend/ reads .env itself; without it the app boots in demo mode
env_args=()
[[ -f .env ]] && env_args=(--env-file .env)

exec .venv/bin/uvicorn app.main:app \
  --app-dir backend \
  --host 127.0.0.1 --port 8000 --reload \
  --timeout-keep-alive 65 \
  "${env_args[@]}" "$@"
