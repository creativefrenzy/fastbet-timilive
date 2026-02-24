#!/bin/bash
set -e

APP_DIR="/home/ubuntu/fastbet-zeeplive"

sudo apt-get update -y

# curl (for NodeSource script, health checks, etc.)
if ! command -v curl >/dev/null 2>&1; then
  sudo apt-get install -y curl
fi

# Node.js 18.x (install if missing)
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# PM2 (always ensure latest)
if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm i -g pm2@latest
else
  sudo npm i -g pm2@latest
fi

# Ensure app dir exists and is owned by ubuntu (CodeDeploy runs as ubuntu)
sudo mkdir -p "$APP_DIR"
sudo chown -R ubuntu:ubuntu "$APP_DIR"

cd "$APP_DIR"

# Install app deps
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# Enable PM2 startup for 'ubuntu'
pm2 startup systemd -u ubuntu --hp /home/ubuntu >/dev/null 2>&1 || true
