# Deployment Guide — Railway (Backend) + Vercel (Frontend)

> Local docker-compose is unchanged. This guide covers production only.

---

## Pre-Deploy Checklist (what's already fine vs. what we fixed)

| Item | Status | Detail |
|------|--------|--------|
| PORT/HOST binding | ✅ Already fine | `process.env.PORT ?? 3001`, host `0.0.0.0` |
| DATABASE_URL from env | ✅ Already fine | Prisma reads `DATABASE_URL` from env, no code fallback |
| JWT_SECRET from env | ✅ Fixed | Now crashes at startup if `JWT_SECRET` is missing in production |
| BLOCKCHAIN_RPC_URL from env | ✅ Already fine | Throws 503 if missing — no hardcoded fallback in source |
| DEPLOYER_PRIVATE_KEY from env | ✅ Already fine | Same — throws 503 |
| SEPOLIA keys from env | ✅ Already fine | Same — throws 503 |
| CORS via env var | ✅ Already fine | `CORS_ORIGIN` env var (comma-separated) |
| `build` script | ✅ Already fine | `tsc --project tsconfig.json` → `dist/` |
| `start` script | ✅ Already fine | `node dist/index.js` |
| `migrate` script | ✅ Added | `tsx ../database/migrate.ts` — run as Railway release command |
| Frontend API URL | ✅ Already fine | Single `NEXT_PUBLIC_API_URL` env var in `lib/api.ts` |
| Hardcoded `localhost:3001` in frontend | ✅ Only as fallback | `lib/api.ts:21` — safe dev-only fallback, all pages go through `useApi()` |

---

## Step 1 — Deploy Frontend to Vercel First

You need the Vercel URL before configuring Railway's CORS.

1. Push your repo to GitHub/GitLab
2. Go to [vercel.com](https://vercel.com) → New Project → Import your repo
3. Set **Root Directory**: `frontend`
4. Framework: **Next.js** (auto-detected)
5. Add environment variable:

   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_API_URL` | `https://your-railway-backend.railway.app` *(fill after Step 2)* |

6. Deploy → note your Vercel URL, e.g. `https://rbac-marketplace.vercel.app`

> **Note:** You'll need to redeploy the frontend once you have the Railway URL, since `NEXT_PUBLIC_API_URL` is baked into the build.

---

## Step 2 — Create Managed Postgres on Railway

1. Railway Dashboard → New Project → **Add PostgreSQL**
2. Railway will provision and give you a `DATABASE_URL` — copy it
   - Format: `postgresql://postgres:PASSWORD@HOST:PORT/railway`

---

## Step 3 — Deploy Backend to Railway

1. Railway → New Service → **GitHub Repo** → select your repo
2. Set **Root Directory**: `backend`
3. Railway auto-detects `package.json` and runs `npm run build` then `npm start`

### Build Command (set in Railway settings)
```
npm run build
```

### Start Command (set in Railway settings)
```
npm start
```

### Release Command — runs migrations before every deploy

> ⚠️ **Read the Migration Strategy section below before setting this.**

```
npm run migrate
```

In Railway: **Settings → Deploy → Release Command** → paste the above.

### Environment Variables to set in Railway

| Variable | Value | Notes |
|----------|-------|-------|
| `NODE_ENV` | `production` | Required — enables prod guards |
| `DATABASE_URL` | *(from Railway Postgres)* | Copy from your Railway Postgres service |
| `JWT_SECRET` | *(generate below)* | Min 32 chars |
| `JWT_EXPIRES_IN` | `7d` | |
| `CORS_ORIGIN` | `https://rbac-marketplace.vercel.app` | Your Vercel URL from Step 1. Comma-separate multiple origins |
| `DEPLOYER_PRIVATE_KEY` | *(Sepolia deployer key)* | |
| `SEPOLIA_RPC_URL` | `https://sepolia.infura.io/v3/YOUR_KEY` | Use your own Infura/Alchemy key in prod |
| `SEPOLIA_DEPLOYER_PRIVATE_KEY` | *(Sepolia deployer key)* | Same key as above unless you want separate wallets |

Generate a strong JWT_SECRET:
```bash
openssl rand -hex 32
```

> ⚠️ **Do NOT set `BLOCKCHAIN_RPC_URL` to `http://127.0.0.1:8545` in production.** Railway containers cannot reach your local Hardhat node. Skip it (local-chain ops return 503) or set it to an Alchemy/Infura endpoint.

---

## Step 4 — Update Frontend with Railway URL

1. In Vercel → your project → Settings → Environment Variables
2. Update `NEXT_PUBLIC_API_URL` to your Railway URL:
   ```
   https://your-service.railway.app
   ```
3. Redeploy (trigger a new build)

---

## Step 5 — Run Seed Data (one-time, after first deploy)

Migrations create the schema but don't seed roles/permissions. Run once via Railway shell:

```bash
# Railway → Service → Shell tab
npm run migrate          # if not using release command
npx tsx ../database/seed.ts
npx tsx seed-role-users.ts
```

---

## Migration Strategy

### ⚠️ Important: The migrate script is NOT idempotent

`database/migrate.ts` runs all `*.sql` files against the DB. `CREATE TABLE` will throw on re-run.

**Option A — Manual (safest for first deploy):**
1. Do NOT set a release command
2. Run once manually from Railway shell: `npm run migrate`
3. For subsequent schema changes, write new migration files and re-run

**Option B — Prisma Migrate (recommended for ongoing):**
Railway release command:
```
npx prisma migrate deploy
```
This is idempotent and tracks which migrations have run in a `_prisma_migrations` table.

> **Current recommendation**: Use Option A for your first production deploy. Migrate to Option B when you need ongoing schema changes.

---

## CORS Configuration

The backend reads `CORS_ORIGIN` as a comma-separated list:

```typescript
// Current implementation in app.ts:
await app.register(cors, {
  origin: process.env['CORS_ORIGIN']?.split(',') ?? '*',
  credentials: true,
});
```

**Prod example (Railway env var):**
```
CORS_ORIGIN=https://rbac-marketplace.vercel.app,https://rbac-marketplace-git-main.vercel.app
```

Include both the production URL and any Vercel preview URLs if needed.

---

## Contracts Artifact Warning

The RWAToken ABI artifact must be present at:
```
contracts/artifacts/contracts/RWAToken.sol/RWAToken.json
```

This is generated by `npx hardhat compile` and may be gitignored. Check:

```bash
# Make sure this is NOT in .gitignore:
contracts/artifacts/
```

If it is gitignored, add it back or add a build step to compile contracts before starting the backend.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `JWT_SECRET environment variable is required in production` | Set `JWT_SECRET` in Railway env vars |
| `BLOCKCHAIN_RPC_URL is not configured` | Expected in prod — set to an RPC endpoint or leave unset (503 on local-chain ops) |
| CORS errors in browser | Check `CORS_ORIGIN` matches your Vercel URL exactly (https://, no trailing slash) |
| Migrations fail on re-deploy | Use `npx prisma migrate deploy` as release command instead of `npm run migrate` |
| `RWAToken artifact not found` | Commit `contracts/artifacts/` to git or add `npx hardhat compile` to build step |
