# Enterprise RBAC & Tokenization Marketplace

A full-stack platform for issuing, approving, tokenizing, and trading real-world assets (RWAs) on EVM-compatible blockchains. Features a multi-stage maker-checker approval workflow, on-chain ERC-20 token deployment via a custom `RWAToken` contract, and a role-based access control system enforced on every API call.

## Stack

| Layer | Technology |
|-------|-----------|
| API | Node.js 20 · Fastify 4 · TypeScript |
| ORM | Prisma 5 · Raw SQL (`$queryRaw`) |
| Database | PostgreSQL 16 |
| Smart Contracts | Solidity 0.8.24 · Hardhat 2.22 · OpenZeppelin 5 |
| Frontend | Next.js 14 App Router · Tailwind CSS 3 |
| Auth | JWT (`@fastify/jwt`) · bcryptjs |
| Blockchain client | ethers.js v6 |

## Monorepo Structure

```
/
├── backend/          Fastify REST API (src/routes, src/modules)
├── contracts/        RWAToken.sol + Hardhat config
├── database/         SQL migrations (migrate.ts) + seed (seed.ts)
├── docs/             Architecture, API reference, RBAC model, tokenization
├── frontend/         Next.js 14 App Router UI
└── tests/            Integration test suite (vitest + supertest)
```

---

## Setup

### Prerequisites

- **Node.js ≥ 20** and **npm ≥ 10**
- **Docker + Docker Compose** (for the database / full-stack mode)
- **Git**

---

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd Future_Transformation
npm install          # installs all workspace dependencies
```

---

### 2. Configure environment variables

Copy the example files and fill in values:

```bash
# Backend API
cp backend/.env.example backend/.env

# Frontend
cp frontend/.env.local.example frontend/.env.local

# Smart contracts (only needed for deploy/verify)
cp contracts/.env.example contracts/.env
```

**`backend/.env` required variables:**

| Variable | Example | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://rbac_user:rbac_password@localhost:5432/rbac_marketplace` | Matches docker-compose defaults |
| `JWT_SECRET` | `openssl rand -hex 32` | Must be ≥ 32 chars in production |
| `JWT_EXPIRES_IN` | `7d` | |
| `PORT` | `3001` | |
| `BLOCKCHAIN_RPC_URL` | `http://127.0.0.1:8545` | Hardhat node or Sepolia RPC |
| `DEPLOYER_PRIVATE_KEY` | `0x...` | Wallet that deployed RWAToken (holds MINTER_ROLE + COMPLIANCE_ROLE) |

**`frontend/.env.local` required variables:**

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` |

**`contracts/.env` required variables:**

| Variable | Notes |
|----------|-------|
| `PRIVATE_KEY` | Deployer private key |
| `LOCALHOST_RPC_URL` | `http://127.0.0.1:8545` |
| `SEPOLIA_RPC_URL` | `https://sepolia.infura.io/v3/<key>` |
| `INFURA_API_KEY` | Infura project key |
| `ETHERSCAN_API_KEY` | For contract verification |

---

### 3. Start the database

```bash
docker compose up -d postgres
```

Wait for it to become healthy (the healthcheck polls every 10 s):

```bash
docker compose ps       # STATUS should show "(healthy)"
```

---

### 4. Run migrations (first run only)

```bash
cd database
npx tsx migrate.ts
```

This applies all SQL migrations in order (`001_extensions_and_enums.sql` → `012_investments_status_text.sql`).

---

### 5. Seed roles and permissions (first run only)

```bash
# still in database/
npx tsx seed.ts
```

Seeds 34 permissions, 10 system roles, role→permission mappings, and 3 approval stage→role entries.

---

### 6. Start development servers

**Option A — Docker (all services):**

```bash
docker compose up
```

Backend: http://localhost:3001  
Frontend: http://localhost:3000  
Health check: http://localhost:3001/health

**Option B — Local (recommended for active development):**

```bash
# Terminal 1 — Backend
cd backend
npm run dev

# Terminal 2 — Frontend
cd frontend
npm run dev
```

---

### 7. (Optional) Start a local blockchain

Required for token deploy/mint endpoints:

```bash
cd contracts
npm run node          # starts Hardhat on http://127.0.0.1:8545 (chain ID 31337)
```

Deploy the RWAToken contract:

```bash
npm run deploy:local
```

Copy the deployed contract address into the asset's token configuration via `POST /api/tokens/deploy`, and set `DEPLOYER_PRIVATE_KEY` + `BLOCKCHAIN_RPC_URL` in `backend/.env`.

---

### 8. Compile contracts (required before deploy or backend token operations)

```bash
cd contracts
npm run compile       # outputs ABI to contracts/artifacts/
```

The backend reads the ABI from `contracts/artifacts/contracts/RWAToken.sol/RWAToken.json`.

---

## Running Tests

Integration tests require a separate test database:

```bash
# In database/.env (or export directly):
TEST_DATABASE_URL=postgresql://rbac_user:rbac_password@localhost:5432/rbac_marketplace_test

cd tests
npx vitest run
```

---

## Database Operations

```bash
cd backend

npm run db:migrate    # prisma migrate dev
npm run db:generate   # regenerate Prisma client after schema changes
npm run db:studio     # open Prisma Studio GUI (localhost:5555)
npm run db:reset      # drop and recreate all tables
```

---

## Documentation

| Doc | Description |
|-----|-------------|
| [`docs/architecture.md`](./docs/architecture.md) | System components, data flow diagrams |
| [`docs/rbac-model.md`](./docs/rbac-model.md) | Roles, permissions, approval stage gating |
| [`docs/api.md`](./docs/api.md) | Full endpoint reference |
| [`docs/tokenization.md`](./docs/tokenization.md) | Asset lifecycle state machine |

---

## Key Design Decisions

- **Live permission checks** — `requirePermission()` queries the DB on every request; permissions are never cached in the JWT.
- **Maker-checker approval** — assets move through `pending_compliance → pending_legal → pending_admin` before approval. Each stage is gated to a specific role enforced server-side.
- **Two-phase investment** — `status='paid'` is committed to the DB before any on-chain operation. A failed mint leaves the investment at `paid` (recoverable) rather than `pending`.
- **Single whitelist/mint code path** — `addToWhitelistOnChain` and `mintOnChain` live in `token.service.ts` and are imported by the investment service, not duplicated.
- **JWT in-memory only** — the frontend stores the JWT in React Context state, not localStorage. A page refresh requires re-login.
