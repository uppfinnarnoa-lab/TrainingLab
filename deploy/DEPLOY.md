# TrainingLab — Production Deployment Guide

Ubuntu 22.04 + Apache 2.4 + PM2 + PostgreSQL. Single-server, self-hosted.

---

## Prerequisites (one-time, on the server)

```bash
# Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20 --default

# pnpm
npm install -g pnpm

# PM2
npm install -g pm2

# PostgreSQL (if not already installed)
sudo apt install -y postgresql postgresql-contrib

# Apache mod_proxy (if not already enabled)
sudo a2enmod proxy proxy_http headers rewrite ssl
```

---

## First Deploy

### 1. Create the database

```bash
sudo -u postgres psql -c "CREATE USER traininglab WITH PASSWORD 'your_strong_password';"
sudo -u postgres psql -c "CREATE DATABASE traininglab OWNER traininglab;"
```

### 2. Clone the repo

```bash
sudo mkdir -p /var/www/traininglab
sudo chown $USER:$USER /var/www/traininglab
cd /var/www/traininglab
git clone https://github.com/YOUR_USERNAME/traininglab.git .
```

### 3. Set up environment variables

```bash
cp deploy/env.production .env
nano .env   # fill in all CHANGE_ME values (see env.production comments)
```

Generate AUTH_SECRET:
```bash
openssl rand -base64 32
```

### 4. Install dependencies and run migrations

```bash
pnpm install --frozen-lockfile
pnpm exec prisma migrate deploy
```

### 5. Build

```bash
pnpm build --no-lint
```

### 6. Start with PM2

```bash
cp deploy/ecosystem.config.js .   # already in repo root, just verify the path
pm2 start ecosystem.config.js
pm2 save                          # persist across reboots
pm2 startup                       # follow the printed command to enable autostart
```

App now runs on `http://localhost:3000`.

### 7. Apache virtual host (SSL via Let's Encrypt)

```bash
sudo nano /etc/apache2/sites-available/traininglab.conf
```

Paste (replace `yourdomain.com`):

```apache
<VirtualHost *:80>
    ServerName yourdomain.com
    Redirect permanent / https://yourdomain.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName yourdomain.com

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/yourdomain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/yourdomain.com/privkey.pem

    ProxyPreserveHost On
    ProxyPass        / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/

    # Forward real client IP to Next.js
    RequestHeader set X-Forwarded-Proto "https"
    RequestHeader set X-Forwarded-For "%{REMOTE_ADDR}s"

    ErrorLog  ${APACHE_LOG_DIR}/traininglab-error.log
    CustomLog ${APACHE_LOG_DIR}/traininglab-access.log combined
</VirtualHost>
```

```bash
sudo a2ensite traininglab.conf
sudo certbot --apache -d yourdomain.com   # installs and auto-renews SSL
sudo apache2ctl configtest
sudo systemctl reload apache2
```

---

## Updating (subsequent deploys)

Just run the update script — it pulls, migrates, builds, and reloads with zero downtime:

```bash
cd /var/www/traininglab
./deploy/update.sh
```

Or from your local machine via SSH:

```bash
ssh user@yourdomain.com "cd /var/www/traininglab && ./deploy/update.sh"
```

---

## Useful commands

```bash
pm2 status                    # check app status
pm2 logs traininglab          # live logs
pm2 logs traininglab --lines 100  # last 100 lines
pm2 restart traininglab       # hard restart (brief downtime)
pm2 reload traininglab        # zero-downtime reload

sudo -u postgres psql traininglab   # psql shell

sudo tail -f /var/log/apache2/traininglab-error.log   # Apache errors
```

---

## Backup

```bash
# Database dump (run daily via cron)
pg_dump -U traininglab traininglab | gzip > /backups/traininglab-$(date +%F).sql.gz

# Crontab entry (daily at 02:00)
0 2 * * * pg_dump -U traininglab traininglab | gzip > /backups/traininglab-$(date +\%F).sql.gz
```

---

## Rollback

```bash
cd /var/www/traininglab
git log --oneline -10          # find the commit to roll back to
git checkout <commit-hash>
pnpm build --no-lint
pm2 reload traininglab
```

To roll back a migration (only if the migration has a `down` migration):
```bash
pnpm exec prisma migrate reset   # ⚠ DESTROYS ALL DATA — only for dev
```
For production rollbacks, restore from a database backup instead.
