# RBAC Model

## Overview

The system uses a database-backed Role-Based Access Control model. Roles and permissions are stored in PostgreSQL and checked on every API request via `requirePermission(key)`. The JWT carries **no permission data** — all checks query live DB state.

### Key properties

- **Least-privilege**: each role holds only the permissions it strictly needs
- **Live checks**: revoke a role → takes effect immediately (no JWT expiry needed)
- **System roles**: `organization_id = NULL, is_system_role = true` — applied globally across all orgs
- **Custom roles**: orgs can create org-scoped roles (not yet exposed via API)

---

## Permission Keys (34 total)

| Group | Permission Key | Description |
|-------|---------------|-------------|
| **Organization** | `organization.read` | Read org profile |
| | `organization.update` | Update org settings |
| **Users** | `user.create` | Create users in org |
| | `user.read` | Read user profiles |
| | `user.update` | Update user profiles |
| | `user.delete` | Deactivate users |
| **Roles** | `role.create` | Create custom roles |
| | `role.update` | Update role permissions |
| | `role.assign` | Assign/revoke roles for users |
| | `permission.manage` | Manage platform permissions |
| **Assets** | `asset.create` | Create draft assets |
| | `asset.read` | Read assets in org |
| | `asset.update` | Update draft assets |
| | `asset.submit` | Submit asset for approval |
| | `asset.approve` | Approve asset at current stage |
| | `asset.reject` | Reject asset with reason |
| **Tokens** | `token.configure` | Set token parameters (symbol, supply, price) |
| | `token.deploy` | Deploy ERC-20 contract on-chain |
| | `token.mint` | Mint tokens to a wallet |
| | `token.burn` | Admin-burn tokens |
| | `token.pause` | Pause token transfers |
| **Compliance** | `compliance.review` | View compliance findings |
| | `compliance.approve` | Issue compliance approval |
| | `compliance.reject` | Issue compliance rejection |
| **Marketplace** | `marketplace.create` | Create a listing for a tokenized asset |
| | `marketplace.publish` | Publish listing (asset → listed) |
| | `marketplace.unpublish` | Take listing offline |
| **Investments** | `investment.view` | View investments |
| | `investment.create` | Submit an investment |
| | `investment.approve` | Approve investment + trigger mint |
| **Transactions** | `transaction.view` | View settlements |
| | `transaction.approve` | Approve settlements |
| **Audit/Reports** | `audit.view` | View audit log |
| | `report.export` | Export compliance reports |

---

## System Roles & Permission Matrix

✓ = granted | — = not granted

| Permission | Platform Admin | Enterprise Admin | Asset Issuer | Compliance Officer | Legal Officer | Treasury Officer | Marketplace Mgr | Operations Mgr | Auditor | Investor | Viewer |
|-----------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `organization.read` | ✓ | ✓ | — | — | — | — | — | ✓ | ✓ | — | ✓ |
| `organization.update` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `user.create` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `user.read` | ✓ | ✓ | — | — | — | — | — | ✓ | ✓ | — | — |
| `user.update` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `user.delete` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `role.create` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `role.update` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `role.assign` | ✓ | ✓ | — | — | — | — | — | — | — | — | — |
| `permission.manage` | ✓ | — | — | — | — | — | — | — | — | — | — |
| `asset.create` | ✓ | — | ✓ | — | — | — | — | — | — | — | — |
| `asset.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `asset.update` | ✓ | — | ✓ | — | — | — | — | — | — | — | — |
| `asset.submit` | ✓ | — | ✓ | — | — | — | — | — | — | — | — |
| `asset.approve` | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — | — |
| `asset.reject` | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — | — |
| `token.configure` | ✓ | — | ✓ | — | — | ✓ | — | — | — | — | — |
| `token.deploy` | ✓ | — | — | — | — | ✓ | — | — | — | — | — |
| `token.mint` | ✓ | — | — | — | — | ✓ | — | — | — | — | — |
| `token.burn` | ✓ | — | — | — | — | ✓ | — | — | — | — | — |
| `token.pause` | ✓ | — | — | — | — | ✓ | — | — | — | — | — |
| `compliance.review` | ✓ | — | — | ✓ | ✓ | — | — | — | — | — | — |
| `compliance.approve` | ✓ | — | — | ✓ | — | — | — | — | — | — | — |
| `compliance.reject` | ✓ | — | — | ✓ | — | — | — | — | — | — | — |
| `marketplace.create` | ✓ | — | — | — | — | — | ✓ | — | — | — | — |
| `marketplace.publish` | ✓ | — | — | — | — | — | ✓ | — | — | — | — |
| `marketplace.unpublish` | ✓ | — | — | — | — | — | ✓ | — | — | — | — |
| `investment.view` | ✓ | ✓ | ✓ | — | — | — | ✓ | ✓ | ✓ | ✓ | — |
| `investment.create` | ✓ | — | — | — | — | — | — | — | — | ✓ | — |
| `investment.approve` | ✓ | — | — | — | — | — | ✓ | — | — | — | — |
| `transaction.view` | ✓ | ✓ | — | — | — | ✓ | — | ✓ | ✓ | — | — |
| `transaction.approve` | ✓ | — | — | — | — | ✓ | — | — | — | — | — |
| `audit.view` | ✓ | ✓ | — | ✓ | ✓ | — | — | ✓ | ✓ | — | — |
| `report.export` | ✓ | ✓ | — | — | — | — | — | ✓ | ✓ | — | — |

---

## Approval Stage → Role Gating

Asset approval is enforced server-side. The endpoint (`POST /api/assets/:id/approve`) infers the required stage from the asset's current status and checks the `approval_stage_roles` table. The client never sends a stage.

| Asset Status | Required Role | Stage Label |
|-------------|--------------|-------------|
| `pending_compliance` | **Compliance Officer** | Compliance Review |
| `pending_legal` | **Legal Officer** | Legal Review |
| `pending_admin` | **Enterprise Admin** | Administrative Approval |

> A user with `asset.approve` but the wrong role for the current stage receives **409 Conflict** with a message naming the required role.

---

## Investment View Scoping

The `investment.view` permission is held by multiple roles, but the scope differs:

| Pattern | Roles | Behaviour |
|---------|-------|-----------|
| **Investor role** | Investor | Sees own investments only (`investor_id = userId`) |
| **Staff roles** | Enterprise Admin, Marketplace Manager, Operations Manager, Auditor | Sees all investments in the organisation |

The frontend determines the pattern by checking: `investment.create ∈ permissions AND investment.approve ∉ permissions` → Investor.

---

## Permission Count per Role

| Role | Permission Count |
|------|:-:|
| Platform Admin | 34 (all) |
| Enterprise Admin | 16 |
| Operations Manager | 7 |
| Auditor | 7 |
| Treasury Officer | 7 |
| Compliance Officer | 6 |
| Legal Officer | 5 |
| Marketplace Manager | 6 |
| Asset Issuer | 6 |
| Investor | 3 |
| Viewer | 2 |
