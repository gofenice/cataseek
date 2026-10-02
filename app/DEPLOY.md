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
1. Live keys: set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` in `.env`
   (or enter them in Admin → Payment Settings). The mode follows the key prefix (`rzp_live_`).
2. In the Razorpay Dashboard (**Live** mode) create one plan per Cataseek plan (monthly + yearly,
   same USD amount), then map them in Admin → Payment Settings → Plan mapping → Live, and click
   **Verify mapping**. Test-mode plans do not exist in Live mode. Checkout refuses unmapped plans.
3. In the Razorpay Dashboard (Live mode), add a webhook:
   - URL: `https://app.yourdomain.com/api/billing/razorpay/webhook`
   - Secret: same value as `RAZORPAY_WEBHOOK_SECRET` / Admin → Payment Settings.
   - Events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
     `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`,
     `subscription.paused`, `subscription.resumed`, `subscription.updated`, `payment.failed`.
4. Enable Payment Settings → "Enable Razorpay checkout".
5. Complete Razorpay KYC and submit your site (Terms/Privacy/Refund/Contact pages are in `../filez/`).
6. Extra currencies (optional). Razorpay charges Indian cards only in INR and cards issued elsewhere
   only in the other currencies, so each currency needs its own price and Razorpay plan:
   Admin → Payment Settings → Plan Mapping & Currencies → pick the currency tab, enter each plan's
   price, then paste the Razorpay plan id (or **Create in Razorpay**), **Verify mapping**, and tick the
   currency under "Offered to customers". Customers get the currency of their country
   (India → INR, UK → GBP, Europe → EUR, otherwise the base currency) and can change it on their
   Billing page until they subscribe. The country comes from Cloudflare's `CF-IPCountry` header, so
   the site must stay proxied through Cloudflare (Network → IP Geolocation on).

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
