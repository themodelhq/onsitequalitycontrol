# Deployment Guide

This app has a **full-stack architecture**:
- **Backend** (Express + tRPC + MySQL) → deploy to **Render**
- **Frontend** (React + Vite) → deploy to **Netlify**

---

## Option A: Deploy Backend to Render + Frontend to Netlify

### 1. Deploy Backend to Render

1. Push your code to GitHub.
2. Go to [render.com](https://render.com) → New → Web Service.
3. Connect your GitHub repo.
4. Set these values:
   - **Build Command:** `npm install -g pnpm && pnpm install --frozen-lockfile && pnpm run build`
   - **Start Command:** `pnpm run start`
   - **Node version:** 20
5. Add Environment Variables in the Render dashboard:
   ```
   NODE_ENV=production
   DATABASE_URL=mysql://user:pass@host:3306/dbname
   OPENAI_API_KEY=sk-...
   SESSION_SECRET=<random 32+ char string>
   ALLOWED_ORIGINS=https://your-app.netlify.app
   ```
6. Click **Deploy**. Note your service URL: `https://your-app.onrender.com`

> **Database**: Use [PlanetScale](https://planetscale.com), [Railway](https://railway.app), or [Aiven](https://aiven.io) for managed MySQL. Copy the connection string as `DATABASE_URL`.

---

### 2. Deploy Frontend to Netlify

1. Go to [netlify.com](https://netlify.com) → Add new site → Import from Git.
2. Connect your GitHub repo.
3. Set build settings:
   - **Build Command:** `npm install -g pnpm && pnpm install --frozen-lockfile && pnpm run build:client`
   - **Publish Directory:** `dist/public`
4. Add Environment Variables:
   ```
   VITE_API_URL=https://your-app.onrender.com
   ```
5. **Update `netlify.toml`**: Replace `YOUR-RENDER-APP` in the proxy redirect with your actual Render URL.
6. Click **Deploy site**.

---

## Option B: Deploy Everything to Render (Monolith)

The backend serves the built frontend from `dist/public`. This is simpler:

1. Push to GitHub.
2. Render → New Web Service → connect repo.
3. **Build:** `npm install -g pnpm && pnpm install --frozen-lockfile && pnpm run build`
4. **Start:** `pnpm run start`
5. Add all env vars (see `.env.example`).
6. Deploy.

No separate Netlify needed — the app is served on one URL.

---

## Database Setup

Run migrations after deploying:

```bash
# Connect to your server (or use Render Shell)
pnpm run db:push
```

This creates all required tables:
- `users` — Authentication
- `products` — Uploaded product data
- `productImages` — Image analysis results
- `analysisResults` — All quality issues
- `analysisBatches` — Upload/analysis run history
- `namingFormats`, `prohibitedItems`, `blacklistedKeywords`, `restrictedBrands`, `sensitiveCategories` — Reference data

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | MySQL connection string |
| `OPENAI_API_KEY` | ✅ | For AI image analysis |
| `SESSION_SECRET` | ✅ | Random string for sessions |
| `NODE_ENV` | ✅ | `production` |
| `PORT` | ⚪ | Server port (default 3000) |
| `GOOGLE_CLIENT_ID` | ⚪ | Google OAuth (optional) |
| `GOOGLE_CLIENT_SECRET` | ⚪ | Google OAuth (optional) |
| `ALLOWED_ORIGINS` | ⚪ | CORS origin for Netlify URL |

---

## Health Check

The backend exposes `/api/health` — Render uses this to monitor uptime.

---

## Troubleshooting

**Build fails on Render:**
- Make sure Node 20+ is selected
- Check that `pnpm-lock.yaml` is committed

**"Cannot connect to database":**
- Verify `DATABASE_URL` format: `mysql://user:pass@host:port/dbname`
- Ensure DB allows connections from Render IPs

**Frontend shows blank page on Netlify:**
- Check that `publish` directory is `dist/public` (not `dist`)
- Confirm `netlify.toml` is at repo root
- Check `[[redirects]]` rule exists for SPA routing

**API calls failing from Netlify:**
- Update the proxy redirect in `netlify.toml` with your Render URL
- Add `ALLOWED_ORIGINS=https://your-app.netlify.app` to Render env vars
