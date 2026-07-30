# Architecture Overview

## System Components

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| **Enterprise Portal** | Next.js 14 App Router | Asset issuance wizard, approval queue, token management, audit log |
| **Investor Portal** | Next.js 14 App Router (same app, permission-gated views) | Marketplace browse, investment submission, portfolio view |
| **Backend API** | Fastify 4 · TypeScript · Prisma | REST API, JWT auth, RBAC enforcement, business logic, blockchain orchestration |
| **Database** | PostgreSQL 16 | Persistent relational storage — assets, tokens, investments, listings, audit logs, RBAC tables |
| **Blockchain Service** | ethers.js v6 (inside backend) | Deploys RWAToken, manages whitelist, mints tokens via deployer wallet |
| **RWAToken Contract** | Solidity 0.8.24 · OpenZeppelin 5 | ERC-20 with supply cap, whitelist enforcement, role-based mint/burn/pause |
| **EVM Chain** | Hardhat (local, chain 31337) / Sepolia (testnet, chain 11155111) | Transaction settlement |

---

## High-Level Component Diagram

```mermaid
graph TB
    subgraph "Browser Clients"
        EP["Enterprise Portal\n(Asset Issuer · Compliance Officer\nLegal Officer · Enterprise Admin\nTreasury Officer · Marketplace Mgr)"]
        IP["Investor Portal\n(Investor · Auditor · Operations Mgr)"]
    end

    subgraph "Backend — Fastify API :3001"
        AUTH["POST /api/auth/login\nPOST /api/auth/logout"]
        ASSETS["Assets\nPOST /api/assets\nPOST /api/assets/:id/submit\nPOST /api/assets/:id/approve\nPOST /api/assets/:id/reject"]
        TOKENS["Tokens\nPOST /api/tokens/configure\nPOST /api/tokens/deploy\nPOST /api/tokens/mint"]
        MKT["Marketplace\nPOST /api/marketplace/listings\nPOST /api/marketplace/listings/:id/publish\nGET  /api/marketplace"]
        INV["Investments\nPOST /api/investments\nPOST /api/investments/:id/approve\nGET  /api/investments"]
        AUDIT["Audit\nGET /api/audit"]
        RBAC["requirePermission(key)\nLive DB check — no JWT cache"]
    end

    subgraph "PostgreSQL 16"
        DB_ASSETS["assets · tokens"]
        DB_RBAC["roles · permissions\nrole_permissions · user_roles\napproval_stage_roles"]
        DB_MKT["marketplace_listings\ninvestments"]
        DB_AUDIT["audit_logs"]
    end

    subgraph "Blockchain"
        WALLET["Deployer Wallet\n(holds MINTER_ROLE\n+ COMPLIANCE_ROLE)"]
        CONTRACT["RWAToken.sol\nERC-20 + whitelist\n+ supply cap + roles"]
    end

    EP -->|"JWT Bearer"| AUTH
    IP -->|"JWT Bearer"| AUTH
    EP -->|"JWT Bearer"| ASSETS
    EP -->|"JWT Bearer"| TOKENS
    EP -->|"JWT Bearer"| MKT
    EP -->|"JWT Bearer"| AUDIT
    IP -->|"JWT Bearer"| MKT
    IP -->|"JWT Bearer"| INV

    ASSETS --> RBAC
    TOKENS --> RBAC
    MKT --> RBAC
    INV --> RBAC
    AUDIT --> RBAC

    RBAC -->|"SELECT permissions\nWHERE user_id = ?"| DB_RBAC
    ASSETS --> DB_ASSETS
    TOKENS --> DB_ASSETS
    MKT --> DB_MKT
    INV --> DB_MKT
    AUDIT --> DB_AUDIT

    TOKENS -->|"ethers.js\nContractFactory.deploy()"| WALLET
    INV -->|"addToWhitelist()\nmint()"| WALLET
    WALLET -->|"JSON-RPC\n:8545 / Sepolia"| CONTRACT
```

---

## Asset Lifecycle Data Flow

```mermaid
sequenceDiagram
    actor Issuer
    actor CO as Compliance Officer
    actor LO as Legal Officer
    actor EA as Enterprise Admin
    actor TM as Treasury/Mkt Manager
    actor Investor

    Issuer->>API: POST /api/assets
    API-->>Issuer: { id, status: "draft" }

    Issuer->>API: POST /api/assets/:id/submit
    API-->>Issuer: { status: "pending_compliance" }

    CO->>API: POST /api/assets/:id/approve
    API->>DB: check approval_stage_roles[pending_compliance] = "Compliance Officer"
    API-->>CO: { status: "pending_legal" }

    LO->>API: POST /api/assets/:id/approve
    API-->>LO: { status: "pending_admin" }

    EA->>API: POST /api/assets/:id/approve
    API-->>EA: { status: "approved" }

    TM->>API: POST /api/tokens/configure
    TM->>API: POST /api/tokens/deploy
    API->>Chain: ContractFactory.deploy(name, symbol, supplyCap, admin)
    Chain-->>API: contractAddress
    API-->>TM: { contractAddress, status: "tokenized" }

    TM->>API: POST /api/marketplace/listings
    TM->>API: POST /api/marketplace/listings/:id/publish
    API-->>TM: { status: "listed" }

    Investor->>API: POST /api/investments
    API-->>Investor: { status: "pending" }

    TM->>API: POST /api/investments/:id/approve
    API->>DB: UPDATE investments SET status = 'paid'
    API->>Chain: addToWhitelist(investorWallet)
    API->>Chain: mint(investorWallet, tokenAmount)
    Chain-->>API: txHash
    API->>DB: UPDATE investments SET status = 'confirmed'
    API-->>TM: { investment, mintTxHash }
```

---

## Permission Check Flow

Every protected route runs `requirePermission(key)` as a Fastify `preHandler`:

```mermaid
flowchart LR
    REQ[Request] --> JWT{Valid JWT?}
    JWT -->|No| R401[401 Unauthorized]
    JWT -->|Yes| PERM{Has permission\nin live DB?}
    PERM -->|No| R403[403 Forbidden]
    PERM -->|Yes| HANDLER[Route handler]
    HANDLER --> DB[(PostgreSQL)]
    HANDLER --> RESP[Response]
```

> **Key property**: permissions are queried from the DB on every request. Revoking a role takes effect immediately — no JWT expiry required.

---

## Security Considerations

| Concern | Approach |
|---------|----------|
| Permission bypass | Live DB check via `requirePermission`; JWT carries no permissions |
| Cross-org access | All queries scope by `organization_id`; returns 403 (not 404) on cross-org |
| Blockchain key management | `DEPLOYER_PRIVATE_KEY` in env; production should use KMS/HSM |
| JWT storage | In-memory React Context only — no localStorage/sessionStorage |
| Token whitelist | `addToWhitelist` required before any `mint` or transfer; enforced on-chain |
| Audit trail | Every lifecycle event written to `audit_logs` with `previous_state` + `new_state` JSONB |
| Mint safety | `paid` status committed to DB before on-chain ops; failed mint leaves recoverable state |
