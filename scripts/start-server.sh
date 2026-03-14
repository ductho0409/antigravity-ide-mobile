#!/bin/bash
# Antigravity Mobile Bridge — Server startup script
# Used by launchd service to ensure correct PATH and environment

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Resolve project directory (parent of scripts/)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR/server" || exit 1

# Non-interactive mode: server auto-skips PIN prompt when stdin is not a TTY
exec node --require ./node_modules/tsx/dist/preflight.cjs \
  --import "file://$(pwd)/node_modules/tsx/dist/loader.mjs" \
  src/index.ts
