#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

# Start Redis via docker-compose if Docker is available
if command -v docker &>/dev/null; then
  if docker compose version &>/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose &>/dev/null; then
    COMPOSE_CMD="docker-compose"
  else
    COMPOSE_CMD=""
  fi

  if [ -n "$COMPOSE_CMD" ]; then
    echo "🔴 Starting Redis via docker-compose..."
    $COMPOSE_CMD up -d redis 2>/dev/null || {
      echo "⚠️  Redis container failed to start — continuing without Redis"
    }

    # Wait for Redis to be healthy (max 10s)
    echo "⏳ Waiting for Redis to be ready..."
    for i in $(seq 1 20); do
      if $COMPOSE_CMD exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; then
        echo "✅ Redis is ready"
        break
      fi
      sleep 0.5
    done
  fi
else
  echo "⚠️  Docker not found — running without Redis (in-memory fallback)"
fi

# Start the dev servers via turbo
echo "🚀 Starting dev servers..."
exec bunx turbo dev --filter=@adventure-fun/web --filter=@adventure-fun/server
