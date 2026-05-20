#!/bin/bash
# TrainingLab deploy script — runs on the Ubuntu server
# Usage: ./deploy.sh
# Remote: ssh user@server "/var/www/traininglab/deploy.sh"

set -e  # exit immediately on error

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$APP_DIR/deploy.log"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "=== Deploy started ==="
cd "$APP_DIR"

log "[1/6] Pulling from git..."
git pull origin main

log "[2/6] Installing dependencies..."
pnpm install --frozen-lockfile

log "[3/6] Generating Prisma client..."
pnpm prisma generate

log "[4/6] Running DB migrations..."
pnpm prisma migrate deploy

log "[5/6] Building Next.js (no lint)..."
pnpm exec next build --no-lint

log "[6/6] Reloading PM2 (zero-downtime)..."
pm2 reload traininglab || pm2 start ecosystem.config.js

log "=== Deploy complete ==="
