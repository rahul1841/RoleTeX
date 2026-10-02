#!/usr/bin/env bash
# Local API with auto-reload. Extra args go to uvicorn (e.g. --port 9000).
set -euo pipefail

# Run from the repo root, where .venv and .env live.
cd "$(dirname "$0")/.."

# The app doesn't load .env itself; without it, MONGODB_URI is unset and it won't start.
env_args=()
[[ -f .env ]] && env_args=(--env-file .env)

# ${arr[@]+...} keeps an empty array safe under `set -u` in macOS's bash 3.2.
exec .venv/bin/uvicorn app.main:app \
  --app-dir backend \
  --host 127.0.0.1 --port 8000 --reload \
  --timeout-keep-alive 65 \
  ${env_args[@]+"${env_args[@]}"} "$@"
