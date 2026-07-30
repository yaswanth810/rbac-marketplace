# DECISIONS.md — Current Codebase State

> Auto-generated sync-up. Reflects *what actually exists today*, not original plans.
> Last updated: 2026-07-29

---

## 1. Architecture

- **Frontend**: Next.js 14, App Router, `src/` layout, `'use client'` where needed
- **Backend**: Fastify 4, TypeScript ESM, Prisma 5 (`$queryRaw` only — no ORM models)
- **DB**: PostgreSQL 16 via Docker (`localhost:5433`), schema via `database/migrations/*.sql`
- **Blockchain**: Ethers v6, Hardhat (chain 31337 local), Sepolia (11155111)
- **Auth**: JWT via `@fastify/jwt`; permissions fetched live from DB on every request (no JWT caching of perms)
- **Org model**: Hard single-tenant — every query is scoped by `organization_id` from JWT

---

## 2. Database Schema (actual tables)

| Table | Key columns | Notes |
|-------|------------|-------|
| `organizations` | id, name | One org in demo |
| `users` | id, org_id, email, password_hash, kyc_status, status, wallet_address | `wallet_address` unique; EIP-55 checksummed |
| `roles` | id, name, organization_id (NULL=system), is_system_role | 10 system roles + custom org roles |
| `permissions` | id, key | 34 permission keys |
| `role_permissions` | role_id, permission_id | Many-to-many |
| `user_roles` | user_id, role_id | Many-to-many |
| `assets` | id, org_id, name, asset_type (enum), status (enum), issuer_id, jurisdiction, currency, total_value, metadata (jsonb), created_at | `metadata.documents[]` stores base64 file uploads |
| `asset_approvals` | id, asset_id, stage, approver_id, decision (enum), comment | Immutable log |
| `approval_stage_roles` | stage (PK), role_name, label | Maps status → role required |
| `tokens` | id, asset_id, contract_address, token_symbol, total_supply, decimals, price, chain_id | One per asset |
| `marketplace_listings` | id, asset_id, status (draft/published/unpublished), published_at | One per asset, unique constraint |
| `investments` | id, asset_id, investor_id, amount, payment_method, status | |
| `audit_logs` | id, user_id, action, resource_type, resource_id, org_id, previous_state, new_state | Append-only |

---

## 3. Asset Status State Machine

```
draft
  └─ [asset.submit] → pending_compliance
      └─ [Compliance Officer] → pending_legal
          └─ [Legal Officer] → pending_admin
              └─ [Enterprise Admin] → approved
                  └─ [Treasury: token deploy] → tokenized
                      └─ [Marketplace Mgr: publish] → listed
              └─ [any approver at their stage] → rejected
```

- `APPROVE_TRANSITIONS` is server-side only: `{ pending_compliance → pending_legal → pending_admin → approved }`
- `approval_stage_roles` table controls which role maps to which stage (editable without code change)
- Two-gate approval: `requirePermission('asset.approve')` is gate 1; service checks caller holds the stage-specific role as gate 2

---

## 4. Approval Stage → Role Mapping

| Stage | Role Required | Label |
|-------|--------------|-------|
| `pending_compliance` | Compliance Officer | Compliance Review |
| `pending_legal` | Legal Officer | Legal Review |
| `pending_admin` | Enterprise Admin | Administrative Approval |

---

## 5. System Roles & Permissions (34 total)

| Role | Key Permissions |
|------|----------------|
| Platform Admin | All 34 |
| Enterprise Admin | org.*, user.*, role.*, asset.read/approve/reject, investment.view, transaction.view, audit.view, report.export |
| Asset Issuer | asset.create/read/update/submit, token.configure, investment.view |
| Compliance Officer | compliance.*, asset.read/approve/reject, audit.view |
| Legal Officer | asset.read/approve/reject, compliance.review, audit.view |
| **Treasury Officer** | token.configure/deploy/mint/burn/pause, asset.read, transaction.view/approve |
| **Marketplace Manager** | marketplace.create/publish/unpublish, asset.read, investment.view/approve |
| Operations Manager | org.read, user.read, asset.read, investment.view, transaction.view, audit.view, report.export |
| Auditor | org.read, user.read, asset.read, investment.view, transaction.view, audit.view, report.export |
| Investor | asset.read, investment.view/create |
| Viewer | org.read, asset.read |

---

## 6. API Endpoints (all registered)

### Auth — `/api/auth`
- `POST /login` — public
- `POST /logout` — JWT required
- `GET /me` — JWT required → `{ userId, email, organizationId, permissions[] }`

### Users — `/api/users`
- `GET /me` — JWT required → `{ id, email, name, wallet_address }`
- `PATCH /me/wallet` — JWT required, body: `{ walletAddress }` → validates EVM addr, checksums, saves

### Assets — `/api/assets`
- `POST /` — `asset.create`
- `GET /` — `asset.read`; query: `?pending_approval=true` (role-filtered), `?status=<value>` (exact match)
- `GET /:id` — `asset.read`
- `PATCH /:id` — `asset.update` (draft only)
- `POST /:id/submit` — `asset.submit`
- `POST /:id/approve` — `asset.approve` + stage-role check (409 if wrong stage)
- `POST /:id/reject` — `asset.reject` + stage-role check, reason required
- `GET /:id/approvals` — `asset.read`

### Tokens — `/api/tokens`
- `POST /configure` — `token.configure`, body: `{ assetId, tokenSymbol, totalSupply, decimals?, price?, chainId }`
- `POST /deploy` — `token.deploy`, body: `{ assetId }` — deploys RWAToken on-chain
- `POST /mint` — `token.mint`, body: `{ assetId, recipientUserId, amount }` (wei string); recipient must be whitelisted
- `GET /:assetId` — **`asset.read`** *(changed from token.configure — visible to all)*

### Marketplace — `/api/marketplace`
- `GET /listings?assetId=` — **`asset.read`** *(changed from marketplace.create — visible to all)*
- `POST /listings` — `marketplace.create`, body: `{ assetId }`
- `POST /listings/:id/publish` — `marketplace.publish`
- `GET /` — JWT only (no perm gate); query: `?asset_class=&currency=`

### Investments — `/api/investments`
- `POST /` — `investment.create`, body: `{ assetId, amount, paymentMethod }`
- `GET /` — `investment.view`
- `POST /:id/approve` — `investment.approve` → whitelists wallet + mints tokens
- `POST /:id/reject` — `investment.approve`

### Audit — `/api/audit`
- `GET /` — `audit.view`

---

## 7. Blockchain Implementation

- **RWAToken.sol**: ERC-20 + whitelist (addToWhitelist/whitelist) + mint/burn/pause roles
- **Artifact path**: `contracts/artifacts/contracts/RWAToken.sol/RWAToken.json` (loaded at runtime)
- **Multi-chain support**: `SUPPORTED_CHAINS` map in `token.service.ts`
  - `31337` → `BLOCKCHAIN_RPC_URL` + `DEPLOYER_PRIVATE_KEY`
  - `11155111` → `SEPOLIA_RPC_URL` + `SEPOLIA_DEPLOYER_PRIVATE_KEY`
- **Auto-whitelist**: Investment approval (`POST /investments/:id/approve`) calls `addToWhitelistOnChain` then `mintOnChain`
- **Manual whitelist**: Mint route requires wallet already whitelisted; no auto-whitelist in that path

---

## 8. Wallet / MetaMask

- **Storage**: `users.wallet_address` (VARCHAR, unique, EIP-55 checksummed)
- **Registration**: `PATCH /api/users/me/wallet` — any authenticated user, no role restriction
- **Retrieval**: `GET /api/users/me` — returns `wallet_address`
- **Frontend**: `WalletConnect.tsx` component — compact (sidebar) and full (portfolio page) modes
- **Sidebar visibility**: WalletConnect badge shown only to Investor role (detected via `isInvestorRole()`)
- **Whitelisting**: On investment approval, investor's wallet is whitelisted on-chain before minting

---

## 9. Frontend Pages (actual routes)

| Route | Access | Purpose |
|-------|--------|---------|
| `/login` | Public | JWT auth |
| `/dashboard` | JWT | KPIs overview |
| `/assets` | `asset.read` | List org assets |
| `/assets/new` | `asset.create` | 2-step wizard (basic info + document upload) |
| `/assets/:id` | `asset.read` | Detail + pipeline banner + role-specific action cards |
| `/approvals` (now "Work Queue") | `asset.approve` OR `token.configure/deploy` OR `marketplace.create/publish` | Unified action queue |
| `/marketplace` | `asset.read` | Published listings grid with cover images |
| `/marketplace/:id` | JWT | Detail with hero image, documents, invest form |
| `/portfolio` | `investment.view` | Portfolio (investors: own; others: all) + wallet connect |
| `/audit` | `audit.view` | Audit log |
| `/workflow` | JWT | How It Works guide |

---

## 10. Pipeline Banner (asset detail page)

Visible to **all users** with `asset.read`. Shows 5 stages:
1. ✓ Approved (green when asset.status >= approved)
2. Configure Token (Treasury Officer)
3. Deploy Token (Treasury Officer)
4. Create Listing (Marketplace Manager)
5. Publish (Marketplace Manager)

Data fetched unconditionally (no permission gate on reads) — `GET /api/tokens/:assetId` and `GET /api/marketplace/listings?assetId=` are both `asset.read` gated now.

---

## 11. Key Permission Changes Made (vs. original design)

| Endpoint | Original Permission | Current Permission | Reason |
|----------|--------------------|--------------------|--------|
| `GET /api/tokens/:assetId` | `token.configure` | `asset.read` | Pipeline banner needs token info for all roles |
| `GET /api/marketplace/listings` | `marketplace.create` | `asset.read` | Pipeline banner needs listing status for all roles |
| `GET /api/assets?status=` | (didn't exist) | `asset.read` | Work Queue page status filter |

---

## 12. Files Touched (Wallet/Multi-chain Session) vs. Core RBAC

| File | Changed In Wallet Session? | In Scope? | RBAC/Approval Logic Touched? |
|------|---------------------------|-----------|------------------------------|
| `token.service.ts` | ✅ Yes | ✅ In scope (multi-chain) | No — only provider/deployer helpers |
| `routes/users.ts` | ✅ Yes (new file) | ✅ In scope (wallet endpoints) | No |
| `WalletConnect.tsx` | ✅ Yes (new file) | ✅ In scope | No |
| `Sidebar.tsx` | ✅ Yes (WalletConnect added) | ✅ Intended | No |
| `routes/tokens.ts` | ✅ Yes (perm change) | ⚠️ Incidental fix | No — only GET permission widened |
| `routes/marketplace.ts` | ✅ Yes (perm change) | ⚠️ Incidental fix | No — only GET permission widened |
| `assets/[id]/page.tsx` | ✅ Yes (pipeline banner) | ⚠️ Incidental (bug fix) | No |
| `routes/assets.ts` | ✅ Yes (?status filter added) | ⚠️ Incidental (Work Queue) | No — approve/reject/submit untouched |
| `asset.service.ts` | ✅ Yes (listAssets statusFilter) | ⚠️ Incidental (Work Queue) | **No** — approveAsset, rejectAsset, submitAsset, APPROVE_TRANSITIONS untouched |
| `requirePermission.ts` | ❌ Not touched | — | N/A — completely clean |
| `approvals/page.tsx` | ✅ Yes (rewritten) | ⚠️ Incidental (Work Queue) | No |

**Bottom line**: `requirePermission.ts`, `approveAsset`, `rejectAsset`, `submitAsset`, `APPROVE_TRANSITIONS`, and `approval_stage_roles` table mapping were **never touched**.

---

## 13. Demo Credentials

| Email | Password | Role |
|-------|----------|------|
| `e2e-admin@test.com` | `RolePass1!` | Enterprise Admin + all roles |
| `admin@demo.com` | `RolePass1!` or `Demo1234!` | Enterprise Admin |
| `issuer@demo.com` | `RolePass1!` or `Demo1234!` | Asset Issuer |
| `compliance@roles.test` | `RolePass1!` | Compliance Officer |
| `legal@roles.test` | `RolePass1!` | Legal Officer |
| `treasury@roles.test` | `RolePass1!` | Treasury Officer |
| `marketplace@roles.test` | `RolePass1!` | Marketplace Manager |
| `investor@roles.test` | `RolePass1!` | Investor |
| `auditor@roles.test` | `RolePass1!` | Auditor |

---

## 14. Hardhat Wallets (local dev only)

| Account | Address | Private Key |
|---------|---------|-------------|
| #0 Deployer (whitelisted by constructor) | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| #1 Investor | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| #2 | `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC` | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |

Sepolia deployer: `0x371F0765550D085611e11B7399aE79cC7fEB9b54` (~0.025 ETH funded)
