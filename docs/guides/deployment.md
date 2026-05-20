# TrainingLab — Deployment Guide (Ubuntu + Apache)

> **Target:** Ubuntu 22.04 LTS · Apache · PM2 · PostgreSQL · Let's Encrypt  
> **Domain example:** `trainer.yourdomain.com` (replace throughout)

---

## 1. Initial Server Setup

### 1.1 System packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget unzip apache2 certbot python3-certbot-apache
```

### 1.2 Node.js 20 (via NodeSource)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # should be v20.x
```

### 1.3 pnpm

```bash
npm install -g pnpm
pnpm --version
```

### 1.4 PM2 (process manager)

```bash
npm install -g pm2
pm2 startup  # run the command it outputs (adds PM2 to systemd)
```

---

## 2. PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql

# Create DB and user
sudo -u postgres psql <<'SQL'
CREATE DATABASE traininglab;
CREATE USER traininglab WITH PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE traininglab TO traininglab;
ALTER DATABASE traininglab OWNER TO traininglab;
SQL
```

Test connection:
```bash
psql -U traininglab -h localhost -d traininglab
```

---

## 3. Clone the Repository

```bash
# Create app directory
sudo mkdir -p /var/www/traininglab
sudo chown $USER:$USER /var/www/traininglab

# Clone
git clone git@github.com:uppfinnarnoa-lab/TrainingLab.git /var/www/traininglab
cd /var/www/traininglab
```

> **SSH key:** Add the server's public key (`~/.ssh/id_ed25519.pub`) to GitHub → Settings → SSH Keys.
> Generate with: `ssh-keygen -t ed25519 -C "server@traininglab"`

---

## 4. Environment Variables

```bash
cp .env.example /var/www/traininglab/.env.local
nano /var/www/traininglab/.env.local
```

Fill in all values:

```env
# Database
DATABASE_URL="postgresql://traininglab:YOUR_PASSWORD@localhost:5432/traininglab"

# NextAuth
AUTH_SECRET="generate with: openssl rand -base64 32"
NEXTAUTH_URL="https://trainer.yourdomain.com"

# Strava (from https://www.strava.com/settings/api)
STRAVA_CLIENT_ID="your_client_id"
STRAVA_CLIENT_SECRET="your_client_secret"

# AI (optional — users can also enter via Settings UI)
ANTHROPIC_API_KEY=""
GOOGLE_AI_API_KEY=""
```

---

## 5. First Deploy

```bash
cd /var/www/traininglab

# Install dependencies
pnpm install --frozen-lockfile

# Generate Prisma client
pnpm prisma generate

# Run database migrations
pnpm prisma migrate deploy

# Seed first user (run once)
pnpm tsx scripts/seed-user.ts

# Build
pnpm build

# Start with PM2
pm2 start ecosystem.config.js
pm2 save  # persist across reboots
```

### ecosystem.config.js (already in repo)

If it doesn't exist, create it:

```js
module.exports = {
  apps: [{
    name: "traininglab",
    script: "node_modules/.bin/next",
    args: "start",
    cwd: "/var/www/traininglab",
    env: {
      NODE_ENV: "production",
      PORT: "3000",
    },
    max_memory_restart: "512M",
  }]
};
```

---

## 6. Apache Reverse Proxy

### Enable required modules

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel headers rewrite ssl
sudo systemctl restart apache2
```

### Create virtual host

```bash
sudo nano /etc/apache2/sites-available/traininglab.conf
```

```apache
<VirtualHost *:80>
  ServerName trainer.yourdomain.com
  # Redirect all HTTP → HTTPS (Let's Encrypt fills this in automatically)
  RewriteEngine On
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]
</VirtualHost>

<VirtualHost *:443>
  ServerName trainer.yourdomain.com

  # SSL — filled in by certbot
  SSLEngine on
  SSLCertificateFile    /etc/letsencrypt/live/trainer.yourdomain.com/fullchain.pem
  SSLCertificateKeyFile /etc/letsencrypt/live/trainer.yourdomain.com/privkey.pem

  # Proxy all traffic to Next.js
  ProxyPreserveHost On
  ProxyPass        / http://localhost:3000/
  ProxyPassReverse / http://localhost:3000/

  # Required for streaming SSE (AI coach responses)
  ProxyPass        /api/coach/chat http://localhost:3000/api/coach/chat
  ProxyPassReverse /api/coach/chat http://localhost:3000/api/coach/chat
  SetEnv proxy-sendchunked 1

  # Security headers
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set X-Content-Type-Options "nosniff"
</VirtualHost>
```

```bash
sudo a2ensite traininglab.conf
sudo a2dissite 000-default.conf
sudo apache2ctl configtest  # should say "Syntax OK"
sudo systemctl reload apache2
```

### SSL with Let's Encrypt

```bash
sudo certbot --apache -d trainer.yourdomain.com
# Follow the prompts — certbot auto-fills the SSL section above
```

Auto-renewal (runs twice daily via systemd):
```bash
sudo systemctl status certbot.timer  # should be active
# Test renewal manually:
sudo certbot renew --dry-run
```

---

## 7. Deploy Script

Save this as `/var/www/traininglab/deploy.sh` and make it executable:

```bash
chmod +x /var/www/traininglab/deploy.sh
```

```bash
#!/bin/bash
set -e  # exit on any error

APP_DIR="/var/www/traininglab"
LOG="$APP_DIR/deploy.log"

echo "=== Deploy started: $(date) ===" | tee -a "$LOG"
cd "$APP_DIR"

# 1. Pull latest code
echo "[1/5] Pulling from git..." | tee -a "$LOG"
git pull origin main 2>&1 | tee -a "$LOG"

# 2. Install/update dependencies
echo "[2/5] Installing dependencies..." | tee -a "$LOG"
pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG"

# 3. Generate Prisma client (picks up schema changes)
echo "[3/5] Generating Prisma client..." | tee -a "$LOG"
pnpm prisma generate 2>&1 | tee -a "$LOG"

# 4. Run any pending DB migrations
echo "[4/5] Running DB migrations..." | tee -a "$LOG"
pnpm prisma migrate deploy 2>&1 | tee -a "$LOG"

# 5. Build
echo "[5/5] Building Next.js..." | tee -a "$LOG"
pnpm build 2>&1 | tee -a "$LOG"

# 6. Reload PM2 (zero-downtime reload)
echo "[6/6] Reloading PM2..." | tee -a "$LOG"
pm2 reload traininglab 2>&1 | tee -a "$LOG"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG"
```

### Usage

```bash
# From your dev machine (push first):
git push origin main

# On the server — run deploy:
ssh user@yourserver.com "cd /var/www/traininglab && ./deploy.sh"

# Or with a one-liner from your dev machine:
ssh user@yourserver.com "/var/www/traininglab/deploy.sh"
```

---

## 8. Optional: SSH Alias (run deploy from dev machine in one command)

Add to `~/.ssh/config` on your local machine:

```
Host traininglab
  HostName yourserver.com
  User ubuntu
  IdentityFile ~/.ssh/your_key
```

Then deploy from your Windows machine:

```powershell
# From PowerShell or Git Bash:
ssh traininglab "/var/www/traininglab/deploy.sh"
```

Or add to your local `package.json`:

```json
"scripts": {
  "deploy": "ssh traininglab '/var/www/traininglab/deploy.sh'"
}
```

Then: `pnpm deploy`

---

## 9. Monitoring & Logs

```bash
# PM2 status
pm2 status
pm2 monit          # live CPU/memory dashboard

# Application logs
pm2 logs traininglab
pm2 logs traininglab --lines 100

# Deploy log
tail -f /var/www/traininglab/deploy.log

# Apache access/error logs
sudo tail -f /var/log/apache2/access.log
sudo tail -f /var/log/apache2/error.log
```

---

## 10. Useful Commands

```bash
# Restart app manually
pm2 restart traininglab

# Stop/start
pm2 stop traininglab
pm2 start traininglab

# Check what's running on port 3000
ss -tlnp | grep 3000

# PostgreSQL
sudo systemctl status postgresql
sudo -u postgres psql -d traininglab -c "SELECT COUNT(*) FROM \"Activity\";"

# Check disk space
df -h

# Check app memory
pm2 status
```

---

## 11. Rollback

If a deploy breaks something:

```bash
cd /var/www/traininglab

# Rollback to previous commit
git log --oneline -5          # find the commit hash to go back to
git checkout <commit-hash>     # OR:
git revert HEAD               # create a revert commit (safer)

# Rebuild and restart
pnpm build && pm2 reload traininglab
```

---

*Last updated: 2026-05-20*
