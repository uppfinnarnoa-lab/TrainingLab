#!/usr/bin/env bash
# TrainingLab — Production deploy/update script
# Run on the server to pull latest code and restart the app.
#
# Usage:
#   chmod +x /var/www/traininglab/deployment/deploy.sh   # once, after first deploy
#   /var/www/traininglab/deployment/deploy.sh
#
# From Windows (SSH key, no password):
#   ssh noa@training.helgars.se "/var/www/traininglab/deployment/deploy.sh"

set -euo pipefail

# Project root is one level up from this script
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PM2_APP="traininglab"

echo "▶ TrainingLab deploy — $(date '+%Y-%m-%d %H:%M:%S')"
cd "$APP_DIR"

echo "→ Pulling latest code..."
git pull --ff-only

echo "→ Installing dependencies..."
pnpm install --frozen-lockfile --prod=false

echo "→ Running database migrations..."
pnpm exec prisma migrate deploy

echo "→ Building app..."
pnpm exec next build --no-lint

echo "→ Reloading PM2..."
pm2 reload "$PM2_APP" --update-env || pm2 start deployment/ecosystem.config.js

echo "✓ Deploy complete"
