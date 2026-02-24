#!/bin/bash
set -e

APP_NAME="fastbet-zeeplive"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 stop "$APP_NAME" || true
  pm2 delete "$APP_NAME" || true
  pm2 save || true
fi

