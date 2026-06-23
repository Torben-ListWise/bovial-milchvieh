# Deployment Guide — Milchvieh Datenanalyse-Assistent

This document covers everything needed to run the app on a **Hetzner VPS** (Ubuntu 24.04) with Hetzner Object Storage and Hetzner Managed PostgreSQL.  
Development on Replit continues to work unchanged — the app falls back to Replit Storage / Replit PostgreSQL when Hetzner credentials are absent.

---

## 1. Architecture overview

| Component | Development (Replit) | Production (Hetzner) |
|---|---|---|
| App server | Replit (EU deployment possible) | Hetzner VPS (Falkenstein FSN1) |
| File storage | Replit Object Storage (GCS, US) | Hetzner Object Storage (S3, FSN1) |
| Database | Replit PostgreSQL (US) | Hetzner Managed PostgreSQL (DE) |
| AI inference | Anthropic API (US — covered by AVV) | Anthropic API (unchanged) |
| Embeddings | Local ONNX model (on-server) | Same — local ONNX model |

---

## 2. Hetzner prerequisites (operator)

Complete these steps in the [Hetzner Console](https://console.hetzner.cloud) before deploying.

### 2a. VPS

- Create a **CX32** (or larger) VPS in **Falkenstein (FSN1)** with **Ubuntu 24.04**.
- Add your SSH public key during creation.
- Note the public IP address.

### 2b. Object Storage bucket

1. Open **Object Storage → Buckets → Create bucket**.
2. Select **Falkenstein (FSN1)** as the location.
3. Note the bucket name (e.g. `milchvieh-prod`).
4. Open **Object Storage → Access Keys → Create access key**.
5. Note the **Access Key ID** and **Secret Access Key**.
6. Endpoint URL: `https://fsn1.your-objectstorage.com`

### 2c. Managed PostgreSQL

1. Open **Databases → Create database cluster**.
2. Select **PostgreSQL 16**, location **Falkenstein (FSN1)**.
3. Note the **connection string** (URI format):
   ```
   postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require
   ```

---

## 3. VPS setup

```bash
# Connect to the VPS
ssh root@<VPS_IP>

# System packages
apt update && apt upgrade -y
apt install -y git nginx certbot python3-certbot-nginx build-essential

# Node.js 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

# pnpm
npm install -g pnpm pm2

# Verify
node -v   # v22.x.x
pnpm -v   # 9.x.x
pm2 -v
```

---

## 4. Application deployment

```bash
# Clone the repository
git clone https://github.com/<org>/milchvieh.git /opt/milchvieh
cd /opt/milchvieh

# Install dependencies (includes ONNX model download)
pnpm install

# Build the API server
pnpm --filter @workspace/api-server run build

# Build the frontend
pnpm --filter milchvieh run build
```

---

## 5. Environment variables

Create `/opt/milchvieh/.env.production` (never commit this file):

```env
# ── Runtime ────────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000

# ── Database ───────────────────────────────────────────────────────────────
DATABASE_URL=postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require

# ── Storage ────────────────────────────────────────────────────────────────
STORAGE_PROVIDER=hetzner
HETZNER_S3_ENDPOINT=https://fsn1.your-objectstorage.com
HETZNER_S3_BUCKET=milchvieh-prod
HETZNER_S3_ACCESS_KEY=<access-key-id>
HETZNER_S3_SECRET_KEY=<secret-access-key>
HETZNER_S3_REGION=eu-central-1

# ── Auth (Clerk) ────────────────────────────────────────────────────────────
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_WEBHOOK_SECRET=whsec_...

# ── AI ─────────────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...

# ── App ────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS=https://yourdomain.de
CRON_SECRET=<random-32-char-string>
```

> **Security**: `chmod 600 /opt/milchvieh/.env.production`

---

## 6. PM2 process manager

Create `/opt/milchvieh/ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [
    {
      name: "milchvieh-api",
      script: "./artifacts/api-server/dist/index.mjs",
      cwd: "/opt/milchvieh",
      env_file: "/opt/milchvieh/.env.production",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      node_args: "--enable-source-maps",
    },
  ],
};
```

```bash
# Start and persist across reboots
pm2 start /opt/milchvieh/ecosystem.config.cjs
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

---

## 7. Nginx reverse proxy + SSL

```bash
# Create site config
cat > /etc/nginx/sites-available/milchvieh << 'EOF'
server {
    listen 80;
    server_name yourdomain.de www.yourdomain.de;

    # Frontend static files
    root /opt/milchvieh/artifacts/milchvieh/dist;
    index index.html;

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # SSE (analysis streaming) — disable buffering
    location /api/analyses/ {
        proxy_pass http://127.0.0.1:3000/api/analyses/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -s /etc/nginx/sites-available/milchvieh /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Obtain SSL certificate
certbot --nginx -d yourdomain.de -d www.yourdomain.de
```

---

## 8. Database migration (Replit → Hetzner)

Run this **once** from your local machine or CI after the Hetzner DB is ready.

```bash
# Dump from Replit PostgreSQL (get DATABASE_URL from Replit secrets)
pg_dump --no-owner --no-acl "$REPLIT_DATABASE_URL" | \
  psql "$HETZNER_DATABASE_URL"
```

The app runs `drizzle-kit push` (or migrations) automatically on first startup;
no manual schema setup is required if the DB is empty.

### Apply pending Drizzle migrations manually

```bash
cd /opt/milchvieh
DATABASE_URL="$HETZNER_DATABASE_URL" pnpm --filter @workspace/db run push
```

---

## 9. File storage migration (Replit → Hetzner)

**Run this script from inside Replit** (Replit sidecar must be accessible for GCS auth).
The script reads every file stored under Replit Object Storage and copies it to Hetzner S3.
Database paths (`/objects/<key>`) stay unchanged — the backend switches via `STORAGE_PROVIDER`.

```bash
# Dry run — no writes, prints all files that would be migrated
HETZNER_S3_ENDPOINT=https://fsn1.your-objectstorage.com \
  HETZNER_S3_BUCKET=milchvieh-prod \
  HETZNER_S3_ACCESS_KEY=<key> \
  HETZNER_S3_SECRET_KEY=<secret> \
  PRIVATE_OBJECT_DIR="$PRIVATE_OBJECT_DIR" \
  pnpm --filter @workspace/api-server tsx src/scripts/migrate-storage.ts --dry-run

# Live run — safe to re-run; files already in Hetzner are skipped automatically
HETZNER_S3_ENDPOINT=https://fsn1.your-objectstorage.com \
  HETZNER_S3_BUCKET=milchvieh-prod \
  HETZNER_S3_ACCESS_KEY=<key> \
  HETZNER_S3_SECRET_KEY=<secret> \
  PRIVATE_OBJECT_DIR="$PRIVATE_OBJECT_DIR" \
  pnpm --filter @workspace/api-server tsx src/scripts/migrate-storage.ts
```

The script:
1. Reads all `object_path` values from `source_files` + `knowledge_documents` tables.
2. For each `/objects/<key>` path, checks if it already exists in Hetzner (skips if yes).
3. Downloads the file from Replit GCS via the Replit adapter.
4. Uploads to Hetzner S3 under the same key.
5. No DB updates needed — paths remain as `/objects/<key>` on both backends.

After a successful run, set `STORAGE_PROVIDER=hetzner` and restart the app.

---

## 10. Zero-downtime migration plan

1. **Deploy new code** with `STORAGE_PROVIDER=replit` — app still uses Replit storage but the Hetzner adapter is ready.
2. **Run storage migration script** with `--dry-run` first, then live.
3. **Switch `STORAGE_PROVIDER=hetzner`** and restart PM2 (`pm2 restart milchvieh-api`).
4. New uploads go directly to Hetzner; old files are already migrated.
5. After 2 weeks without issues, remove Replit Object Storage bucket.

---

## 11. Updates

```bash
cd /opt/milchvieh
git pull
pnpm install
pnpm --filter @workspace/api-server run build
pnpm --filter milchvieh run build
pm2 restart milchvieh-api
```

---

## 12. Useful PM2 commands

```bash
pm2 status              # process list
pm2 logs milchvieh-api  # tail logs
pm2 monit               # live CPU/RAM monitor
pm2 restart milchvieh-api
pm2 stop milchvieh-api
```

---

## 13. Transaktions-E-Mails mit Resend

### Voraussetzungen (Betreiber erledigt vorab)

1. **Resend-Konto anlegen** unter [resend.com](https://resend.com) (EU-Server wählbar).
2. **Domain verifizieren** — ohne verifizierte Domain landen E-Mails im Spam.
   - Öffne Resend → Domains → Add Domain → trage z.B. `milchvieh.de` ein.
   - Füge folgende DNS-Einträge beim Domain-Registrar ein:

   | Typ | Name | Wert |
   |-----|------|------|
   | MX | `send.milchvieh.de` | `feedback-smtp.eu-west-1.amazonses.com` (Resend gibt exakte Werte vor) |
   | TXT (SPF) | `send.milchvieh.de` | `v=spf1 include:amazonses.com ~all` |
   | CNAME (DKIM) | `resend._domainkey.milchvieh.de` | *(Resend-Dashboard gibt exakten Wert vor)* |
   | TXT (DMARC) | `_dmarc.milchvieh.de` | `v=DMARC1; p=none; rua=mailto:dmarc@milchvieh.de` |

   > **Hinweis:** Die genauen Werte werden im Resend-Dashboard angezeigt. DNS-Propagation dauert bis zu 48 h.

3. **API-Key erstellen**: Resend → API Keys → Create API Key (Scope: Sending access).

### Umgebungsvariablen setzen

```bash
RESEND_API_KEY=re_xxxxxxxxxxxx        # Resend API Key
EMAIL_FROM=noreply@milchvieh.de       # Verifizierte Absender-Adresse
APP_URL=https://app.milchvieh.de      # Basis-URL der App (für Links in E-Mails)
```

> Ohne `RESEND_API_KEY` werden alle E-Mail-Aufrufe still übersprungen — die App läuft stabil, nur ohne E-Mails.

### E-Mail-Typen

| Trigger | Methode | Zeitpunkt |
|---------|---------|-----------|
| Erste Anmeldung | `sendWelcome` | Sofort nach User-Provisioning |
| Stripe-Zahlung erfolgreich | `sendPlanActivated` | Webhook `checkout.session.completed` |
| 80 % Kontingent verbraucht | `sendQuotaWarning` | Nach Quota-Increment (einmalig pro Monat) |
| Zahlung fehlgeschlagen | `sendPaymentFailed` | Webhook `invoice.payment_failed` |
| Monatlicher Digest | `sendMonthlyDigest` | 1. des Monats, 07:00 Uhr (Cron oder in-process) |

### Digest-Cron (externer Trigger, empfohlen für Produktion)

```bash
# POST am 1. des Monats um 07:00 Uhr
curl -X POST https://api.milchvieh.de/api/admin/cron/run-digest \
  -H "X-Cron-Secret: $CRON_SECRET"
```

Alternativ läuft ein In-Process-Scheduler mit stündlicher Prüfung (automatisch aktiv).

### Abmeldung (DSGVO / TDDDG)

Digest-E-Mails enthalten einen Abmelde-Link:
`GET /api/email/unsubscribe?token=<hmac>&uid=<userId>`

Der Token ist ein HMAC-SHA256 über die User-ID (Schlüssel: `RESEND_API_KEY`). Stateless, kein DB-Lookup für die Validierung nötig.
