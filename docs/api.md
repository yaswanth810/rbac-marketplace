# API Reference

**Base URL**: `http://localhost:3001`  
**Auth**: All endpoints (except `POST /api/auth/login`) require `Authorization: Bearer <token>`.  
**Error shape**: `{ statusCode: number, error: string, message: string }`

---

## Auth — `/api/auth`

### `POST /api/auth/login`
No auth required.

**Body**
```json
{ "email": "user@example.com", "password": "secret" }
```

**Response 200**
```json
{
  "token": "<jwt>",
  "expiresIn": "7d",
  "user": {
    "id": "<uuid>",
    "name": "Alice",
    "email": "user@example.com",
    "organizationId": "<uuid>",
    "permissions": ["asset.create", "asset.read", "..."]
  }
}
```

**Errors**: `401` invalid credentials · `403` account inactive

---

### `POST /api/auth/logout`
**Auth required** (JWT must be valid; 401 if missing/invalid).  
Stateless — client discards the token. Returns `{ "message": "Logged out successfully" }`.

---

## Assets — `/api/assets`

### `POST /api/assets` — `asset.create`
Creates an asset in `draft` status, org-scoped to the caller.

**Body**
```json
{
  "name": "Green Energy Bond A",
  "asset_type": "bond",
  "description": "...",
  "jurisdiction": "US",
  "currency": "USD",
  "total_value": 1000000
}
```

**Response 201** — asset row with `status: "draft"`

---

### `GET /api/assets` — `asset.read`
Returns all assets in the caller's organisation.

**Response 200** — array of asset rows

---

### `GET /api/assets/:id` — `asset.read`
Returns a single asset. **403** if the asset belongs to a different org.

---

### `PATCH /api/assets/:id` — `asset.update`
Updates mutable fields on a `draft` asset.  
**409** if the asset is not in `draft` status.

**Body**: any subset of `{ name, description, jurisdiction, currency, total_value }`

---

### `POST /api/assets/:id/submit` — `asset.submit`
Moves asset from `draft` → `pending_compliance`.  
**409** if current status is not `draft`.

**Response 200** — updated asset with `status: "pending_compliance"`

---

### `POST /api/assets/:id/approve` — `asset.approve`
Single consolidated approval endpoint. Stage is **inferred server-side** from the asset's current status. Never send a stage from the client.

| Current status | Required role | Next status |
|---------------|--------------|-------------|
| `pending_compliance` | Compliance Officer | `pending_legal` |
| `pending_legal` | Legal Officer | `pending_admin` |
| `pending_admin` | Enterprise Admin | `approved` |

**Response 200**
```json
{
  "asset": { "id": "...", "status": "pending_legal", "..." },
  "approvalRecord": { "approved_by": "<userId>", "stage": "pending_compliance", "..." }
}
```

**Errors**: `409` wrong stage for caller's role (message names the required role) · `409` invalid status

---

### `POST /api/assets/:id/reject` — `asset.reject`
Rejects asset from any `pending_*` stage → `rejected`.

**Body**: `{ "reason": "Incomplete documentation" }`

**Response 200** — updated asset with `status: "rejected"`

---

## Tokens — `/api/tokens`

### `POST /api/tokens/configure` — `token.configure`
Creates token parameters for an `approved` asset. Must be called before deploy.

**Body**
```json
{
  "assetId": "<uuid>",
  "tokenSymbol": "GBOND",
  "totalSupply": 1000000,
  "decimals": 18,
  "price": 1.00,
  "chainId": 31337
}
```

> `totalSupply` is in **whole-token units**. The RWAToken constructor multiplies by `10^decimals` internally. Do not pass wei.

**Response 201** — token configuration row  
**Errors**: `409` asset not `approved` · `409` configuration already exists

---

### `POST /api/tokens/deploy` — `token.deploy`
Deploys the `RWAToken` ERC-20 contract on-chain. Moves asset status → `tokenized`.

**Body**: `{ "assetId": "<uuid>" }`

**Response 200** — token row with `contract_address`  
**Errors**: `409` token not configured · `409` already deployed · `503` blockchain not configured

---

### `POST /api/tokens/mint` — `token.mint`
Mints tokens to a recipient (must already be whitelisted on-chain).

**Body**
```json
{
  "assetId": "<uuid>",
  "recipientUserId": "<uuid>",
  "amount": "1000000000000000000"
}
```

> `amount` is in **wei** (string to avoid JS precision loss). `1000000000000000000` = 1 token with 18 decimals.

**Response 200**: `{ "txHash": "0x..." }`  
**Errors**: `409` recipient not whitelisted (use investment approval flow) · `502` on-chain failure

---

## Marketplace — `/api/marketplace`

### `POST /api/marketplace/listings` — `marketplace.create`
Creates a listing in `draft` status for a `tokenized` asset.

**Body**: `{ "assetId": "<uuid>" }`

**Response 201** — listing row  
**Errors**: `409` asset not `tokenized` · `409` listing already exists

---

### `POST /api/marketplace/listings/:id/publish` — `marketplace.publish`
Publishes the listing: listing → `published`, asset → `listed`. Atomic transaction.

**Response 200** — updated listing row

---

### `GET /api/marketplace`
JWT required; no specific permission. Returns all `published` listings in the caller's org.

**Query params** (all optional):

| Param | Maps to |
|-------|---------|
| `asset_class` | `assets.asset_type` |
| `currency` | `assets.currency` |
| `issuer` | `assets.issuer_id` (UUID) |
| `risk` | `assets.metadata->>'risk_level'` |

**Response 200**
```json
[
  {
    "id": "<listing-uuid>",
    "asset_id": "<uuid>",
    "status": "published",
    "published_at": "2025-01-15T10:00:00Z",
    "asset_name": "Green Energy Bond A",
    "asset_type": "bond",
    "currency": "USD",
    "total_value": "1000000",
    "token_symbol": "GBOND",
    "token_price": "1.00",
    "token_supply": "1000000"
  }
]
```

---

## Investments — `/api/investments`

### `POST /api/investments` — `investment.create`
Creates an investment in `pending` status.

**Pre-conditions**:
- Caller's `kyc_status = 'approved'` (403 if not)
- Asset must be `listed`
- Payment method must be one of: `bank_transfer`, `crypto`, `card`, `stablecoin`

**Body**
```json
{
  "assetId": "<uuid>",
  "amount": 50000,
  "paymentMethod": "bank_transfer"
}
```

**Response 201** — investment row  
**Errors**: `403` KYC not approved · `409` asset not listed

---

### `POST /api/investments/:id/approve` — `investment.approve`
Two-phase approval:

1. Commits `status = 'paid'` to DB (mocked payment)
2. Calls `addToWhitelist(investorWallet)` on the RWAToken contract
3. Calls `mint(investorWallet, tokenAmount)` on the RWAToken contract
4. Commits `status = 'confirmed'`

Token allocation = `floor(amount / token_price)` tokens × `10^decimals`.

If the on-chain step fails, the investment stays at `paid` (recoverable). A 502 response is returned.

**Response 200**
```json
{
  "investment": { "id": "...", "status": "confirmed", "..." },
  "whitelistTxHash": "0x..." ,
  "mintTxHash": "0x..."
}
```

**Errors**: `409` not pending · `409` no wallet registered for investor · `502` on-chain failure

---

### `GET /api/investments` — `investment.view`
Returns investments. Scoped by role:
- **Investor**: own investments only
- **All other roles with `investment.view`**: all investments in the org

**Response 200** — array of investment rows

---

### `GET /api/investments/:id` — `investment.view`
Returns a single investment. Returns **403** (not 404) for cross-org access to avoid resource enumeration.

---

## Audit — `/api/audit`

### `GET /api/audit` — `audit.view`
Returns the 100 most recent audit log entries for the caller's organisation, newest first.

**Response 200**
```json
[
  {
    "id": "<uuid>",
    "user_id": "<uuid>",
    "action": "investment.confirmed",
    "resource_type": "investment",
    "resource_id": "<uuid>",
    "organization_id": "<uuid>",
    "previous_state": { "status": "paid" },
    "new_state": {
      "status": "confirmed",
      "wallet": "0x...",
      "tokenAmount": "1000000000000000000",
      "whitelistTxHash": "0x...",
      "mintTxHash": "0x..."
    },
    "ip_address": null,
    "created_at": "2025-01-15T12:00:00Z"
  }
]
```

---

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 400 | Bad Request — missing or invalid body fields |
| 401 | Unauthorized — missing or invalid JWT |
| 403 | Forbidden — valid JWT but insufficient permission, or cross-org access |
| 404 | Not Found — (rarely used; see 403 note above) |
| 409 | Conflict — wrong status for the requested operation |
| 502 | Bad Gateway — on-chain transaction failed; investment left at `paid` |
| 503 | Service Unavailable — blockchain env vars not configured |
