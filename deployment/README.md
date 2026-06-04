# TrainingLab — Deployment Guide (Ubuntu + nginx)

> **Target:** Ubuntu 22.04 LTS · nginx · PM2 · PostgreSQL · Let's Encrypt wildcard cert  
> **Domain:** `training.helgars.se` — existing `*.helgars.se` cert reused from `theodal.helgars.se`  
> **Multi-user:** Closed invite system — users register, admin (you) approves in Settings.

---

## ⚠ 0. SSL Cert — Sort This First

**The wildcard cert expires 15 June 2026.**

```bash
sudo certbot renew --dry-run
```

- **"Congratulations, all renewals succeeded"** → auto-renewal works, nothing to do.
- **"Challenge failed"** → continue below.

Wildcard certs require DNS-01 challenge. Check what certbot is configured to do:

```bash
sudo cat /etc/letsencrypt/renewal/helgars.se.conf
```

Look for `authenticator =`:
- `dns-...` → DNS plugin configured, should auto-renew.
- `manual` → requires manual action each time (Step D below).

**Manual renewal (worst case, once per 90 days):**
```bash
sudo certbot certonly --manual --preferred-challenges dns -d "*.helgars.se"
```
Certbot prints a TXT value — add it as `_acme-challenge.helgars.se` in DNS, wait a minute, press Enter. Set a calendar reminder for 60 days out.

---

## 1. Prerequisites (already in place)

- nginx with `theodal.helgars.se`
- Wildcard cert `*.helgars.se`
- DNS A record `training.helgars.se` → server IP

Find existing cert path (needed for nginx config):
```bash
grep -r "ssl_certificate" /etc/nginx/sites-enabled/
```

---

## 2. System Packages

```bash
sudo apt update && sudo apt upgrade -y

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

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

**Required fields:**
- `DATABASE_URL` — PostgreSQL connection string
- `AUTH_SECRET` — generate with `openssl rand -base64 32`
- `NEXTAUTH_URL` — your public domain (e.g. `https://training.helgars.se`)
- `ENCRYPTION_KEY` — generate with `openssl rand -base64 32` (encrypts Strava/Garmin tokens)

**Strava/Garmin:** Either set in `.env.local` OR configure via Settings UI after first login. The env vars are a convenient alternative to the UI — both work identically.

**AI keys:** Leave blank. Each user sets their own in Settings → AI Coach.

---

## 6. First Deploy

```bash
cd /var/www/traininglab

pnpm install --frozen-lockfile
pnpm prisma generate
pnpm prisma db push          # creates all tables on the fresh DB (first time only)
pnpm build
```

---

## 7. Create Admin Account

After the DB is created, create your admin account from the command line:

```bash
npx tsx scripts/create-user.ts your@email.com yourpassword "Your Name"
```

Then make it admin:

```bash
npx prisma db execute --stdin --schema prisma/schema.prisma << 'EOF'
UPDATE "User" SET status = 'active', "isAdmin" = true WHERE email = 'your@email.com';
EOF
```

> **Never create accounts via the /register page for the admin user** — that creates a `pending` account that can't log in until approved.

---

## 8. PM2

```bash
pm2 start deployment/ecosystem.config.js
pm2 save
pm2 startup   # run the sudo command it prints
```

---

## 9. nginx Server Block

Create `/etc/nginx/sites-available/traininglab.conf`. Replace cert paths with what Step 1 showed.

```nginx
server {
    listen 443 ssl;
    server_name training.helgars.se;

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
sudo nginx -t
sudo systemctl reload nginx
```

---

## 10. Strava OAuth Setup

Strava credentials are shared at the app level — one Strava developer app for all users. Individual users each connect their own Strava account via OAuth.

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api)
2. Set **Authorization Callback Domain** to: `training.helgars.se`
3. Log in as admin → Settings → Strava → enter Client ID + Client Secret → Save

> Alternatively, set `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` in `.env.local` instead.  
> The env vars and the Settings UI are equivalent — whichever is set takes effect.

---

## 11. How Multi-User Works

### Adding a new user

1. Your friend visits `https://training.helgars.se/register`
2. They fill in name, email, password → account created with `status: pending`
3. You log in → Settings → **Users** → Approve their request
4. They can now log in and connect their own Strava account

### API isolation

| Resource | Isolation |
|----------|-----------|
| Activity data | Per-user — completely separate DB rows |
| Strava OAuth tokens | Per-user — each user's access/refresh tokens are encrypted separately |
| Garmin tokens | Per-user |
| AI API keys | Per-user — each user enters their own Claude/Gemini key |
| Strava developer credentials | Shared app-level (admin sets once) — only used for OAuth handshake, not for data access |
| Fitness cache / stats | Per-user |

### Revoking access

Settings → Users → Revoke (next to any active user). They are immediately blocked from logging in.

---

## 12. Post-Deploy Checklist

```
[ ] https://training.helgars.se — padlock green, no warnings
[ ] Log in as admin user
[ ] Settings → Strava → enter Client ID + Client Secret → Save
[ ] Settings → Strava → Connect with Strava → authorize
[ ] Settings → Strava → Sync new activities → confirm count
[ ] Settings → Strava → Backfill all historical activities
      (runs until Strava daily limit; resumes automatically each night at 00:30 UTC)
[ ] Settings → Strava → Backfill weather data
[ ] Stats page loads with data
[ ] AI Coach: enter your Claude or Gemini API key in Settings → AI Coach
[ ] Invite a friend: tell them to visit /register, then approve in Settings → Users
[ ] PM2 survives reboot: sudo reboot → pm2 list
```

---

## 13. Updates (after first deploy)

Set up SSH key-based auth (do this once):
```bash
# On Windows (PowerShell):
ssh-keygen -t ed25519 -C "windows-deploy"
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh noa@training.helgars.se "cat >> ~/.ssh/authorized_keys"
```

Then deploy without any password:
```powershell
ssh noa@training.helgars.se "/var/www/traininglab/deployment/deploy.sh"
```

The `deploy.sh` script: pulls latest code, regenerates Prisma client, applies schema changes (additive only), builds, reloads PM2.

---

## 14. Database Safety

**The database is never touched by a `git pull`.**  `deploy.sh` uses `prisma db push` which:
- Creates new tables/columns when added to the schema ✓
- **Will drop columns/tables if you remove them from schema.prisma** ⚠

**Safe schema workflow:** Only add new columns/tables. Never remove existing ones in production without first archiving the data.

**Commands that WILL destroy data — never run in production:**
```bash
pnpm prisma migrate reset   # ⚠ drops and recreates the entire database
pnpm prisma db push --force-reset  # ⚠ same
```

**What persists across all redeploys:**
- All PostgreSQL data
- `.env.local`
- PM2 process config

---

## 15. Database Backup

```bash
# Manual dump
pg_dump -U traininglab traininglab | gzip > ~/traininglab-$(date +%F).sql.gz

# Automated daily at 02:00 — add to crontab (crontab -e):
0 2 * * * pg_dump -U traininglab traininglab | gzip > /var/backups/traininglab-$(date +\%F).sql.gz
```

---

## 16. Monitoring & Logs

```bash
pm2 status
pm2 logs traininglab
pm2 logs traininglab --lines 100

sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
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

---

## 18. Cert Renewal (routine)

```bash
sudo systemctl status certbot.timer    # should be active
sudo certbot renew --dry-run           # test manually
```

---

## 19. Useful Commands

```bash
pm2 restart traininglab
pm2 reload traininglab         # zero-downtime reload
pm2 stop traininglab

sudo nginx -t
sudo systemctl reload nginx

ss -tlnp | grep 3000           # confirm Next.js is listening
sudo -u postgres psql -d traininglab -c 'SELECT COUNT(*) FROM "Activity";'
df -h
```

---

*Last updated: 2026-06-04*
