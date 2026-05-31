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

**The wildcard cert expires 15 June 2026. Sort this out first.**

### Step A — Check if auto-renewal works at all

```bash
sudo certbot renew --dry-run
```

- **"Congratulations, all renewals succeeded"** → auto-renewal works, nothing to do.
- **"Challenge failed"** or error → continue to Step B.

### Step B — Find out what DNS challenge method is used

Wildcard certs (`*.helgars.se`) require DNS-01 challenge — certbot must create a TXT record
`_acme-challenge.helgars.se` in DNS to prove you own the domain.

Check what certbot is configured to do:
```bash
sudo cat /etc/letsencrypt/renewal/helgars.se.conf
# folder name may differ — check: ls /etc/letsencrypt/renewal/
```

Look for the `authenticator =` line:
- `dns-...` → DNS plugin configured, should work automatically
- `manual` → renewal requires manual action (see Step D)
- `standalone` or `webroot` → won't work for wildcards, cert was obtained manually

### Step C — Check FortDDNS involvement

Who controls the authoritative DNS for `helgars.se`?

```bash
dig NS helgars.se
```

- **Nameservers at your registrar** (Loopia, One.com, etc.): FortDDNS only updates the A record.
  Cert renewal needs a registrar plugin, or a manual DNS edit at the registrar each time.
- **Nameservers at FortDDNS**: FortDDNS controls DNS entirely. Check if they have an API for
  certbot. Contact FortDDNS support to ask how others handle Let's Encrypt wildcard renewal.

### Step D — Worst case: manual renewal (once per 90 days)

```bash
sudo certbot certonly --manual --preferred-challenges dns -d "*.helgars.se"
```

Certbot prints a TXT value — add it as `_acme-challenge.helgars.se` in DNS (at registrar or
FortDDNS panel), wait a minute, then press Enter. Set a calendar reminder for 60 days out.

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
cp deployment/env.example /var/www/traininglab/.env.local
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

Start using the config in this folder:

```bash
pm2 start deployment/ecosystem.config.js
pm2 save
pm2 startup   # run the sudo command it prints
```

---

## 8. nginx Server Block

Create `/etc/nginx/sites-available/traininglab.conf`.
**Replace the cert paths** with whatever Step 1 showed.

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

## 11. Database Safety

**The database is never touched by a redeploy.** `git pull` only updates code files — PostgreSQL runs separately and is not affected. `prisma migrate deploy` only applies new schema migrations (additive changes like new columns/tables) — it never drops data.

**Commands that WILL destroy data — never run these in production:**
```bash
pnpm prisma migrate reset   # ⚠ drops and recreates the entire database
pnpm prisma db push         # ⚠ can drop columns/tables to match schema
pnpm tsx scripts/seed-user.ts  # only run once on first deploy, not on updates
```

**What persists across all redeploys:**
- All PostgreSQL data (activities, user settings, cached stats, etc.)
- `.env.local` (never in git, never touched by deploy)
- PM2 process config

---

## 12. Updates (after first deploy)

> **Use SSH keys, never passwords in scripts.** Set up key-based auth:
> ```bash
> # On Windows (PowerShell):
> ssh-keygen -t ed25519 -C "windows-deploy"
> type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh noa@training.helgars.se "cat >> ~/.ssh/authorized_keys"
> ```
> Then deploy without any password:

```powershell
# From Windows:
ssh noa@training.helgars.se "/var/www/traininglab/deployment/deploy.sh"
```

Or on the server directly:
```bash
/var/www/traininglab/deployment/deploy.sh
```

---

## 13. Monitoring & Logs

```bash
pm2 status
pm2 logs traininglab
pm2 logs traininglab --lines 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

tail -f /var/www/traininglab/deploy.log
```

---

## 14. Cert Renewal

The wildcard cert auto-renews via certbot's systemd timer (~30 days before expiry).

```bash
sudo systemctl status certbot.timer    # should be active
sudo certbot renew --dry-run           # test renewal manually
```

> If renewal fails, follow steps 1b above.

---

## 15. First-Run App Setup

After the server is up and you can reach https://training.helgars.se:

```
[ ] Log in as admin user (created by seed script)
[ ] Settings → Change your password
[ ] Settings → Strava → enter Client ID + Secret → Save
[ ] Settings → Strava → Connect with Strava → authorize
[ ] Settings → Strava → Sync new activities
[ ] Settings → Strava → Backfill all historical activities (auto-resumes nightly)
[ ] Settings → Strava → Backfill weather data
[ ] Settings → Profile → fill in name, weight, height, experience
[ ] Settings → HR Zones → enter max HR and resting HR
[ ] Settings → Sports → verify/add sport types and workout types
[ ] Settings → AI Coach → enter Anthropic or Google API key → test in Coach tab
[ ] Stats page loads with data
[ ] Dashboard shows recent activities
```

---

## 16. Database Backup

```bash
# Manual dump
pg_dump -U traininglab traininglab | gzip > ~/traininglab-$(date +%F).sql.gz

# Automated daily at 02:00 — add to crontab (crontab -e):
0 2 * * * pg_dump -U traininglab traininglab | gzip > /var/backups/traininglab-$(date +\%F).sql.gz
```

---

## 17. Rollback

```bash
cd /var/www/traininglab
git log --oneline -10
git checkout <commit-hash>
pnpm exec next build --no-lint
pm2 reload traininglab
```

For DB rollback: restore from backup — never use `prisma migrate reset` in production.

---

## 18. Useful Commands

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

*Last updated: 2026-05-28*
