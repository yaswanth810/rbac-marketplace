'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { canIssueAssets, canApproveAssets, PENDING_STAGES } from '@/lib/permissions';
import { Card } from '@/components/ui/Card';
import { PageSpinner } from '@/components/ui/Spinner';

interface Asset { id: string; status: string }
interface Listing { id: string }

export default function DashboardPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const [assets, setAssets] = useState<Asset[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<Asset[]>('/api/assets').catch(() => []),
      api.get<Listing[]>('/api/marketplace').catch(() => []),
    ]).then(([a, l]) => {
      setAssets(a);
      setListings(l);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return <PageSpinner />;

  const pending = assets.filter((a) => PENDING_STAGES.includes(a.status as typeof PENDING_STAGES[number]));

  const stats = [
    { label: 'Total Assets', value: assets.length, href: '/assets' },
    { label: 'Pending Approvals', value: pending.length, href: '/approvals' },
    { label: 'Active Listings', value: listings.length, href: '/marketplace' },
  ];

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-white">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href}>
            <Card className="cursor-pointer hover:border-indigo-600 transition-colors">
              <p className="text-sm text-gray-400">{s.label}</p>
              <p className="mt-1 text-3xl font-bold text-white">{s.value}</p>
            </Card>
          </Link>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        {canIssueAssets(permissions) && (
          <Link
            href="/assets/new"
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            + Create Asset
          </Link>
        )}
        {canApproveAssets(permissions) && pending.length > 0 && (
          <Link
            href="/approvals"
            className="rounded-md border border-yellow-600 px-4 py-2 text-sm font-medium text-yellow-300 hover:bg-yellow-900/30 transition-colors"
          >
            Review {pending.length} pending approval{pending.length !== 1 ? 's' : ''}
          </Link>
        )}
      </div>
    </div>
  );
}
