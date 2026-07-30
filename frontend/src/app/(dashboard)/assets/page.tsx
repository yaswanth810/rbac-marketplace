'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { canIssueAssets } from '@/lib/permissions';
import { Card } from '@/components/ui/Card';
import { AssetStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { PageSpinner, ErrorMessage, EmptyState } from '@/components/ui/Spinner';

interface Asset {
  id: string;
  name: string;
  asset_type: string;
  status: string;
  currency: string | null;
  total_value: string | null;
  created_at: string;
}

export default function AssetsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];

  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    api.get<Asset[]>('/api/assets')
      .then(setAssets)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Assets</h1>
        {canIssueAssets(permissions) && (
          <Link href="/assets/new">
            <Button>+ New Asset</Button>
          </Link>
        )}
      </div>

      {loading && <PageSpinner />}
      {error   && <ErrorMessage message={error} />}

      {!loading && !error && assets.length === 0 && (
        <EmptyState message="No assets found. Create your first asset to get started." />
      )}

      {!loading && !error && assets.length > 0 && (
        <Card padding={false}>
          <table className="min-w-full divide-y divide-gray-700">
            <thead>
              <tr>
                {['Name', 'Type', 'Currency', 'Status', 'Created'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {assets.map((asset) => (
                <tr key={asset.id} className="hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    {/* Asset name links to the detail page */}
                    <Link href={`/assets/${asset.id}`} className="block group">
                      <p className="text-sm font-medium text-white group-hover:text-indigo-300 transition-colors">
                        {asset.name}
                      </p>
                      <p className="text-xs text-gray-500">{asset.id.slice(0, 8)}…</p>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300 capitalize">
                    {asset.asset_type.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-300">
                    {asset.currency ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <AssetStatusBadge status={asset.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(asset.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
