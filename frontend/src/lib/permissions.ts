/**
 * lib/permissions.ts
 *
 * Pure helpers for permission-gated UI.
 * All functions take the permissions array from the JWT payload.
 * No React dependencies — safe to use in both client components and tests.
 */

export function hasPermission(permissions: string[], key: string): boolean {
  return permissions.includes(key);
}

export function hasAnyPermission(permissions: string[], keys: string[]): boolean {
  return keys.some((k) => permissions.includes(k));
}

// ── Role-based helpers ────────────────────────────────────────────────────────
// These are inferred from permission combinations, not a "role" field in the JWT.

/** User can create and submit assets for review. */
export function canIssueAssets(permissions: string[]): boolean {
  return hasPermission(permissions, 'asset.create');
}

/** User can approve/reject assets at any approval stage. */
export function canApproveAssets(permissions: string[]): boolean {
  return hasPermission(permissions, 'asset.approve');
}

/**
 * User is in the Investor role.
 * Heuristic: has investment.create but NOT investment.approve.
 * Investors see their own portfolio; org staff see all investments.
 */
export function isInvestorRole(permissions: string[]): boolean {
  return (
    hasPermission(permissions, 'investment.create') &&
    !hasPermission(permissions, 'investment.approve')
  );
}

/** User can see the audit log page. */
export function canViewAudit(permissions: string[]): boolean {
  return hasPermission(permissions, 'audit.view');
}

/** User can configure or deploy tokens. */
export function canManageTokens(permissions: string[]): boolean {
  return hasAnyPermission(permissions, ['token.configure', 'token.deploy']);
}

/** User can create/publish marketplace listings. */
export function canManageListings(permissions: string[]): boolean {
  return hasAnyPermission(permissions, ['marketplace.create', 'marketplace.publish']);
}

// ── Status display helpers ────────────────────────────────────────────────────

export type AssetStatus =
  | 'draft'
  | 'pending_compliance'
  | 'pending_legal'
  | 'pending_admin'
  | 'approved'
  | 'rejected'
  | 'tokenized'
  | 'listed';

export const ASSET_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_compliance: 'Compliance Review',
  pending_legal: 'Legal Review',
  pending_admin: 'Admin Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  tokenized: 'Tokenized',
  listed: 'Listed',
};

export const PENDING_STAGES = [
  'pending_compliance',
  'pending_legal',
  'pending_admin',
] as const;

export type InvestmentStatus = 'pending' | 'paid' | 'confirmed' | 'settled' | 'cancelled';

export const INVESTMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  paid: 'Payment Captured',
  confirmed: 'Confirmed',
  settled: 'Settled',
  cancelled: 'Cancelled',
};
