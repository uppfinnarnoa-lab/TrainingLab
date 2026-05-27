# TrainingLab — Deployment Guide (Ubuntu + nginx)

> **Target:** Ubuntu 22.04 LTS · nginx · PM2 · PostgreSQL · Let's Encrypt wildcard cert  
> **Domain:** `training.helgars.se` — existing `*.helgars.se` cert reused from `theodal.helgars.se`

---

## 1. Prerequisites (already in place)

The following are already configured on the server — no action needed:

- nginx running with `theodal.helgars.se`
- Wildcard cert `*.helgars.se` (Let's Encrypt, auto-renewing via certbot)
- DNS A record `training.helgars.se` → server IP
- Port 443 forwarded to this server

Find the existing cert path (needed for Step 6):
```bash
grep -r "ssl_certificate" /etc/nginx/sites-enabled/
```

---

## ⚠ 1b. Fix Cert Renewal Before Deploying

**The wildcard cert expires in ~19 days (15 June 2026). Sort this out first.**

### Step A — Check if auto-renewal works at all

```bash
sudo certbot renew --dry-run
```

- If it says **"Congratulations, all renewals succeeded"** → auto-renewal works, nothing to do.
- If it says **"Challenge failed"** or similar error → continue to Step B.

### Step B — Find out what DNS challenge method is used

Wildcard certs (`*.helgars.se`) require DNS-01 challenge — certbot must create a TXT record
`_acme-challenge.helgars.se` in DNS to prove you own the domain.

Check what certbot is configured to do:
```bash
sudo cat /etc/letsencrypt/renewal/helgars.se.conf
# (folder name may differ — check: ls /etc/letsencrypt/renewal/)
```

Look for the `authenticator =` line:
- `authenticator = dns-...` → certbot has a DNS plugin configured, should work automatically
- `authenticator = manual` → renewal requires manual action (see Step C)
- `authenticator = standalone` or `webroot` → this won't work for wildcards, cert was likely obtained manually

### Step C — If renewal is manual or broken: check FortDDNS

The key question is: **who controls the authoritative DNS for `helgars.se`?**

```bash
dig NS helgars.se
```

- **If the nameservers belong to your domain registrar** (e.g. Loopia, One.com): FortDDNS only
  updates the A record, not the nameservers. Cert renewal needs a plugin for that registrar,
  or a manual DNS edit at the registrar each time.
- **If the nameservers belong to FortDDNS**: FortDDNS controls DNS entirely. Check if FortDDNS
  has an API — if yes, there may be a certbot plugin for it. Contact FortDDNS support to ask
  how other users handle Let's Encrypt wildcard cert renewal.

### Step D — Worst case: manual renewal (once per 90 days)

If no automatic method is available, renew manually:
```bash
sudo certbot certonly --manual --preferred-challenges dns -d "*.helgars.se"
```
Certbot prints a TXT value to add as `_acme-challenge.helgars.se` in DNS.
Add it at your registrar or FortDDNS panel, wait a minute, then press Enter.
Set a calendar reminder for 60 days from now so you don't forget.

---

## 2. System Packages

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should be v20.x

# pnpm + PM2
sudo npm install -g pnpm pm2

# PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
```

---

## 3. PostgreSQL

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE traininglab;
CREATE USER traininglab WITH PASSWORD 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE traininglab TO traininglab;
ALTER DATABASE traininglab OWNER TO traininglab;
SQL
```

Test:
```bash
psql -U traininglab -h localhost -d traininglab
```

---

## 4. Clone the Repository

```bash
sudo mkdir -p /var/www/traininglab
sudo chown $USER:$USER /var/www/traininglab

# Add server SSH key to GitHub first:
ssh-keygen -t ed25519 -C "server@traininglab"
cat ~/.ssh/id_ed25519.pub   # paste into GitHub → Settings → SSH Keys

git clone git@github.com:uppfinnarnoa-lab/TrainingLab.git /var/www/traininglab
cd /var/www/traininglab
```

---

## 5. Environment Variables

```bash
cp .env.example /var/www/traininglab/.env.local
nano /var/www/traininglab/.env.local
```

```env
# Database
DATABASE_URL="postgresql://traininglab:YOUR_PASSWORD@localhost:5432/traininglab"

# NextAuth
AUTH_SECRET="run: openssl rand -base64 32"
NEXTAUTH_URL="https://training.helgars.se"

# Strava (from https://www.strava.com/settings/api)
STRAVA_CLIENT_ID="your_client_id"
STRAVA_CLIENT_SECRET="your_client_secret"
STRAVA_REDIRECT_URI="https://training.helgars.se/api/strava/callback"

# AI (optional — users can also enter via Settings UI)
ANTHROPIC_API_KEY=""
GOOGLE_AI_API_KEY=""
```

---

## 6. First Deploy

```bash
cd /var/www/traininglab

pnpm install --frozen-lockfile
pnpm prisma generate
pnpm prisma migrate deploy
pnpm tsx scripts/seed-user.ts    # creates admin user — run once only
pnpm build
```

---

## 7. PM2

`ecosystem.config.js` is already in the repo. If missing, create it:

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

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # run the sudo command it prints
```

---

## 8. nginx Server Block

Create `/etc/nginx/sites-available/traininglab.conf`.
**Replace the cert paths** with whatever `grep ssl_certificate` showed in Step 1.

```nginx
server {
    listen 443 ssl;
    server_name training.helgars.se;

    # Reuse existing wildcard cert (same as theodal.helgars.se)
    ssl_certificate     /etc/letsencrypt/live/helgars.se/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/helgars.se/privkey.pem;

    # SSE streaming — buffering must be disabled for these endpoints
    location ~ ^/api/(coach/chat|strava/backfill-history|strava/backfill-weather) {
        proxy_pass          http://localhost:3000;
        proxy_http_version  1.1;
        proxy_buffering     off;
        proxy_cache         off;
        proxy_set_header    Connection '';
        proxy_set_header    Host $host;
        proxy_read_timeout  3600s;
    }

    # Everything else
    location / {
        proxy_pass          http://localhost:3000;
        proxy_http_version  1.1;
        proxy_set_header    Upgrade $http_upgrade;
        proxy_set_header    Connection 'upgrade';
        proxy_set_header    Host $host;
        proxy_cache_bypass  $http_upgrade;
    }
}
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/traininglab.conf /etc/nginx/sites-enabled/
sudo nginx -t                   # must say "syntax is ok"
sudo systemctl reload nginx
```

---

## 9. Strava OAuth

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Set **Authorization Callback Domain** to: `training.helgars.se`
3. Open the app → Settings → enter Client ID + Client Secret → Save

---

## 10. Post-Deploy Checklist

```
[ ] https://training.helgars.se — padlock green, no browser warning
[ ] Log in as admin user
[ ] Settings → Strava Client ID + Secret → Save
[ ] Settings → Connect with Strava → authorize
[ ] Settings → Sync new activities → confirm count
[ ] Settings → Backfill all historical activities
      (runs until Strava daily limit, auto-resumes nightly 00:30 UTC)
[ ] Settings → Backfill weather data
[ ] Stats page loads with data
[ ] PM2 survives reboot: sudo reboot → pm2 list
```

---

## 11. Deploy Script

Save as `/var/www/traininglab/deploy.sh` and `chmod +x`:

```bash
#!/bin/bash
set -e

APP_DIR="/var/www/traininglab"
LOG="$APP_DIR/deploy.log"

echo "=== Deploy started: $(date) ===" | tee -a "$LOG"
cd "$APP_DIR"

echo "[1/5] Pulling..." | tee -a "$LOG"
git pull origin main 2>&1 | tee -a "$LOG"

echo "[2/5] Installing dependencies..." | tee -a "$LOG"
pnpm install --frozen-lockfile 2>&1 | tee -a "$LOG"

echo "[3/5] Generating Prisma client..." | tee -a "$LOG"
pnpm prisma generate 2>&1 | tee -a "$LOG"

echo "[4/5] Running DB migrations..." | tee -a "$LOG"
pnpm prisma migrate deploy 2>&1 | tee -a "$LOG"

echo "[5/5] Building..." | tee -a "$LOG"
pnpm build 2>&1 | tee -a "$LOG"

echo "[6/6] Reloading PM2..." | tee -a "$LOG"
pm2 reload traininglab 2>&1 | tee -a "$LOG"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG"
```

Run from your Windows machine:
```powershell
ssh user@training.helgars.se "/var/www/traininglab/deploy.sh"
```

---

## 12. Monitoring & Logs

```bash
pm2 status
pm2 logs traininglab
pm2 logs traininglab --lines 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

tail -f /var/www/traininglab/deploy.log
```

---

## 13. Cert Renewal

The wildcard cert auto-renews via certbot's systemd timer (~30 days before expiry).
No action needed — it covers all `*.helgars.se` subdomains including `training`.

```bash
sudo systemctl status certbot.timer    # should be active
sudo certbot renew --dry-run           # test renewal manually
```

> **Note:** Wildcard certs use DNS-01 challenge. If renewal fails, check how theodal's
> cert renews (certbot hooks or manual DNS update) and apply the same method.

---

## 14. Useful Commands

```bash
pm2 restart traininglab
pm2 reload traininglab         # zero-downtime reload
pm2 stop traininglab

sudo nginx -t                  # validate config syntax
sudo systemctl reload nginx

ss -tlnp | grep 3000           # confirm Next.js is listening
sudo -u postgres psql -d traininglab -c 'SELECT COUNT(*) FROM "Activity";'
df -h
```

---

*Last updated: 2026-05-27*
