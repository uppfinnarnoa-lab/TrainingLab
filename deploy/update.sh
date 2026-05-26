#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TrainingLab — Production deploy/update script
# Run this on the server to pull latest code and restart the app.
#
# Usage:
#   chmod +x /var/www/traininglab/deploy/update.sh   # once, after first deploy
#   /var/www/traininglab/deploy/update.sh
#
# Safe to run repeatedly — idempotent.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/var/www/traininglab"
PM2_APP="traininglab"

echo "▶ TrainingLab deploy — $(date '+%Y-%m-%d %H:%M:%S')"

cd "$APP_DIR"

# ── 1. Pull latest code ───────────────────────────────────────────────────────
echo "→ Pulling latest code..."
git pull --ff-only

# ── 2. Install / sync dependencies ───────────────────────────────────────────
echo "→ Installing dependencies..."
pnpm install --frozen-lockfile --prod=false

# ── 3. Apply any pending DB migrations ───────────────────────────────────────
echo "→ Running database migrations..."
pnpm exec prisma migrate deploy

# ── 4. Build Next.js ─────────────────────────────────────────────────────────
echo "→ Building app..."
pnpm build --no-lint

# ── 5. Reload PM2 (zero-downtime) ────────────────────────────────────────────
echo "→ Reloading PM2..."
pm2 reload "$PM2_APP" --update-env

echo "✓ Deploy complete — $(pm2 show $PM2_APP | grep 'status' | head -1 | xargs)"
