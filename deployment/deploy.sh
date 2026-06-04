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

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PM2_APP="traininglab"

echo "▶ TrainingLab deploy — $(date '+%Y-%m-%d %H:%M:%S')"
cd "$APP_DIR"

echo "→ Pulling latest code..."
git pull --ff-only

echo "→ Installing dependencies..."
pnpm install --frozen-lockfile --prod=false

echo "→ Regenerating Prisma client..."
pnpm exec prisma generate

echo "→ Applying schema changes..."
# This project manages the schema with prisma db push (not migration files).
# db push is safe here because schema changes are always additive (new columns/tables only).
# NEVER remove a column or table from schema.prisma without first archiving the data —
# db push will drop them from the database immediately.
pnpm exec prisma db push --skip-generate

echo "→ Building app..."
pnpm exec next build --no-lint

echo "→ Reloading PM2..."
pm2 reload "$PM2_APP" --update-env || pm2 start deployment/ecosystem.config.js

echo "✓ Deploy complete — $(date '+%Y-%m-%d %H:%M:%S')"
