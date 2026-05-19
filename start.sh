#!/usr/bin/env bash
# TrainingLab — start script
# Usage: ./start.sh
# Works on: Linux (Ubuntu), macOS, Windows Git Bash / WSL

set -e
cd "$(dirname "$0")"

echo "▶ Starting TrainingLab..."

# ── 1. Start Docker ────────────────────────────────────────────────────────
if ! docker info > /dev/null 2>&1; then
  echo "  Docker is not running. Starting Docker Desktop..."
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Windows Git Bash
    "/c/Program Files/Docker/Docker/Docker Desktop.exe" &
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    open -a Docker
  else
    echo "  Please start Docker manually, then re-run this script."
    exit 1
  fi

  echo -n "  Waiting for Docker..."
  until docker info > /dev/null 2>&1; do
    sleep 2; echo -n "."
  done
  echo " ready."
fi

# ── 2. Start PostgreSQL ────────────────────────────────────────────────────
echo "  Starting database..."
docker-compose up -d

echo -n "  Waiting for database to be healthy..."
until docker exec traininglab-db pg_isready -U traininglab > /dev/null 2>&1; do
  sleep 1; echo -n "."
done
echo " ready."

# ── 3. Generate Prisma client (skips if already up to date) ───────────────
echo "  Checking Prisma client..."
pnpm prisma generate --silent 2>/dev/null || true

# ── 4. Start dev server ────────────────────────────────────────────────────
echo ""
echo "✓ Database running at localhost:5432"
echo "✓ Starting dev server at http://localhost:3000"
echo "  Press Ctrl+C to stop."
echo ""
pnpm dev
