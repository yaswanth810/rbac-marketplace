'use client';

import React from 'react';

type BadgeVariant =
  | 'gray'
  | 'yellow'
  | 'green'
  | 'red'
  | 'blue'
  | 'orange'
  | 'purple';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  gray:   'bg-gray-700 text-gray-200',
  yellow: 'bg-yellow-900 text-yellow-300',
  green:  'bg-green-900 text-green-300',
  red:    'bg-red-900 text-red-300',
  blue:   'bg-blue-900 text-blue-300',
  orange: 'bg-orange-900 text-orange-300',
  purple: 'bg-purple-900 text-purple-300',
};

export function Badge({ children, variant = 'gray', className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        VARIANT_CLASSES[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}

// ── Asset status badge ────────────────────────────────────────────────────────

const ASSET_STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'gray',
  pending_compliance: 'yellow',
  pending_legal: 'yellow',
  pending_admin: 'yellow',
  approved: 'green',
  rejected: 'red',
  tokenized: 'blue',
  listed: 'blue',
};

const ASSET_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_compliance: 'Compliance Review',
  pending_legal: 'Legal Review',
  pending_admin: 'Admin Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  tokenized: 'Tokenized',
  listed: 'Listed',
};

export function AssetStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={ASSET_STATUS_VARIANT[status] ?? 'gray'}>
      {ASSET_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

// ── Investment status badge ───────────────────────────────────────────────────

const INVESTMENT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  pending: 'yellow',
  paid: 'orange',
  confirmed: 'green',
  settled: 'blue',
  cancelled: 'gray',
};

const INVESTMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  paid: 'Payment Captured',
  confirmed: 'Confirmed',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

export function InvestmentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={INVESTMENT_STATUS_VARIANT[status] ?? 'gray'}>
      {INVESTMENT_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}
