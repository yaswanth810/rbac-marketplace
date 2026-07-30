'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth';
import {
  canViewAudit,
  isInvestorRole,
  hasPermission,
  hasAnyPermission,
} from '@/lib/permissions';
import { WalletConnect } from '@/components/WalletConnect';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

const ICONS = {
  dashboard: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  assets: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
  approvals: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  marketplace: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z',
  portfolio: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  audit: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  workflow: 'M13 10V3L4 14h7v7l9-11h-7z',
  logout: 'M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1',
};

export function Sidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const permissions = user?.permissions ?? [];

  const navItems: NavItem[] = [
    {
      href: '/dashboard',
      label: 'Dashboard',
      icon: <NavIcon path={ICONS.dashboard} />,
    },
    ...(hasPermission(permissions, 'asset.read')
      ? [{ href: '/assets', label: 'Assets', icon: <NavIcon path={ICONS.assets} /> }]
      : []),
    ...(hasAnyPermission(permissions, [
        'asset.approve',
        'token.configure',
        'token.deploy',
        'marketplace.create',
        'marketplace.publish',
      ])
      ? [{ href: '/approvals', label: 'Work Queue', icon: <NavIcon path={ICONS.approvals} /> }]
      : []),
    ...(hasPermission(permissions, 'asset.read')
      ? [{ href: '/marketplace', label: 'Marketplace', icon: <NavIcon path={ICONS.marketplace} /> }]
      : []),
    ...(hasPermission(permissions, 'investment.view')
      ? [{
          href: '/portfolio',
          label: isInvestorRole(permissions) ? 'My Portfolio' : 'Investments',
          icon: <NavIcon path={ICONS.portfolio} />,
        }]
      : []),
    ...(canViewAudit(permissions)
      ? [{ href: '/audit', label: 'Audit Log', icon: <NavIcon path={ICONS.audit} /> }]
      : []),
    // Workflow guide — always visible to any authenticated user
    { href: '/workflow', label: 'How It Works', icon: <NavIcon path={ICONS.workflow} /> },
  ];

  return (
    <aside className="flex h-full w-56 flex-col border-r border-gray-700 bg-gray-900">
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-gray-700 px-4">
        <span className="text-sm font-semibold text-white">RBAC Marketplace</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={[
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                    active
                      ? 'bg-indigo-900/60 text-indigo-200'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-gray-100',
                  ].join(' ')}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User footer */}
      <div className="border-t border-gray-700 p-3 space-y-2">
        <div className="px-2">
          <p className="truncate text-xs font-medium text-gray-300">
            {user?.userId?.slice(0, 8)}…
          </p>
          <p className="text-xs text-gray-500">
            {permissions.length} permissions
          </p>
        </div>

        {/* MetaMask connect — Investor role only */}
        {isInvestorRole(permissions) && (
          <WalletConnect compact />
        )}

        <button
          onClick={logout}
          className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-red-400 transition-colors"
        >
          <NavIcon path={ICONS.logout} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
