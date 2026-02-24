#!/bin/bash
set -e

APP_DIR="/home/ubuntu/fastbet-zeeplive"
APP_NAME="fastbet-zeeplive"
PORT="${PORT:-3000}"

cd "$APP_DIR"

# Export PORT for your app
export NODE_ENV=production
export PORT="$PORT"

# Start or reload with PM2
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env
else
  # Start exactly as you run locally
  pm2 start src/index.js --name "$APP_NAME"
fi

# Persist pm2 process list
pm2 save

