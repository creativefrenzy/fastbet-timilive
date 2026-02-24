#!/bin/bash
set -e

APP_NAME="fastbet-zeeplive"
PORT="${PORT:-3000}"

# Ensure curl exists
if ! command -v curl >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y curl
fi

# Ensure PM2 process exists
pm2 describe "$APP_NAME" >/dev/null 2>&1

# Give the app a moment to bind
sleep 2

# Try /health first; if not present, fall back to /
if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "Health check OK (/health)"
elif curl -fsS "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  echo "Health check OK (/)"
else
  echo "Health check failed" >&2
  exit 1
fi

