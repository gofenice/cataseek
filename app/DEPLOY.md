# Cataseek — Production Deployment Guide

## Architecture
- **App (this folder)** — Express API + serves the built dashboard SPA. Runs on a port (default 3000) behind a reverse proxy.
- **Dashboard** (`dashboard/`) — React app, built into `dashboard/dist/` and served by the Express app.
- **Landing site** (`../filez/`) — static marketing pages; host separately on your main domain.
- **MySQL** + **Meilisearch** — data + search engine.

Recommended production domains:
- `yourdomain.com` → landing site (static)
- `app.yourdomain.com` → this app (dashboard + API)

---

## 1. Prerequisites
- Node.js 20+, MySQL 8+, Meilisearch, and a process manager (PM2).
- A reverse proxy (nginx/Caddy) terminating HTTPS.

## 2. Configure
```bash
cp .env.example .env
# Fill in: DB, JWT_SECRET, SMTP, ADMIN_*, FRONTEND_URL=https://app.yourdomain.com
```
Generate a strong JWT secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 3. Build
```bash
# Backend
npm ci
npm run build            # → dist/

# Dashboard (served by the backend)
cd dashboard && npm ci && npm run build && cd ..
```

## 4. Seed the admin account
```bash
npx ts-node src/scripts/seed-admin.ts     # reads ADMIN_EMAIL / ADMIN_PASSWORD
```
The DB tables and lifecycle columns auto-create on first boot (lazy migrations).

## 5. Run
```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

## 6. Reverse proxy (nginx example)
```nginx
server {
  server_name app.yourdomain.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```
Then issue HTTPS with `certbot --nginx` (or use Caddy for automatic TLS).

> The app calls `app.set('trust proxy', 1)` automatically in production so rate limiting sees real client IPs.

## 7. Payments (Razorpay)
1. Admin → Payment Settings → enter live Key ID/Secret, set mode = live, enable.
2. In the Razorpay dashboard, add a webhook:
   - URL: `https://app.yourdomain.com/api/billing/razorpay/webhook`
   - Secret: same value you saved in Admin → Payment Settings.
   - Events: `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `payment.failed`.
3. Complete Razorpay KYC and submit your site (Terms/Privacy/Refund/Contact pages are in `../filez/`).

## 8. Landing site
Upload `../filez/*.html`, `cataseek-app.jsx`, `tweaks-panel.jsx`, `legal-style.css` to your static host on `yourdomain.com`.
Edit `DASHBOARD_URL` in `cataseek-app.jsx` to `https://app.yourdomain.com`.

## 9. Backups & monitoring (do not skip)
- **MySQL**: nightly `mysqldump` (cron) retained off-box.
- **Meilisearch**: enable snapshots/dumps.
- **Uptime**: an external HTTP check on `https://app.yourdomain.com/api/health`.
- **Errors**: add Sentry (or similar) DSN if you want aggregated error tracking.

## Operational notes
- Email flows (verification, password reset, trial/usage/dunning) require valid SMTP creds — without them, emails silently fail.
- Schedulers (trial + usage sweeps) run inside the app process; with multiple PM2 instances they'd duplicate — keep `instances: 1` or guard with a lock before scaling out.
