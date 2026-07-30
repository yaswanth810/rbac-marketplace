'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { hasPermission, isInvestorRole } from '@/lib/permissions';
import { Card } from '@/components/ui/Card';
import { InvestmentStatusBadge } from '@/components/ui/Badge';
import { PageSpinner, ErrorMessage, EmptyState } from '@/components/ui/Spinner';
import { WalletConnect } from '@/components/WalletConnect';

interface Investment {
  id: string;
  asset_id: string;
  investor_id: string;
  amount: string;
  status: string;
  payment_method: string | null;
  created_at: string;
}

export default function PortfolioPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const isInvestor = isInvestorRole(permissions);
  const canApprove = hasPermission(permissions, 'investment.approve');

  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<Record<string, string>>({});

  const loadInvestments = () => {
    setLoading(true);
    api.get<Investment[]>('/api/investments')
      .then(setInvestments)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadInvestments();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async (invId: string) => {
    setApproving(invId);
    setApproveError((prev) => ({ ...prev, [invId]: '' }));
    try {
      await api.post(`/api/investments/${invId}/approve`, {});
      loadInvestments();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Approval failed';
      setApproveError((prev) => ({ ...prev, [invId]: msg }));
    } finally {
      setApproving(null);
    }
  };

  const pageTitle = isInvestor ? 'My Portfolio' : 'Investments';
  const emptyMsg = isInvestor
    ? 'You have no investments yet. Browse the Marketplace to invest.'
    : 'No investments found for your organisation.';

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-white">{pageTitle}</h1>

      {/* Wallet connect card — investor only */}
      {isInvestor && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Your Wallet</h2>
          <p className="text-xs text-gray-500 mb-4">
            Connect your MetaMask wallet so tokens can be minted to your address when your investment is approved.
            Your wallet must be registered before the Marketplace Manager can settle on-chain.
          </p>
          <WalletConnect />
        </Card>
      )}

      {loading && <PageSpinner />}
      {error && <ErrorMessage message={error} />}
      {!loading && !error && investments.length === 0 && <EmptyState message={emptyMsg} />}

      {!loading && !error && investments.length > 0 && (
        <div className="space-y-3">
          {investments.map((inv) => (
            <Card key={inv.id}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-gray-500">Asset ID: {inv.asset_id.slice(0, 8)}…</p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {Number(inv.amount).toLocaleString()}
                  </p>
                  <p className="text-xs text-gray-400">
                    {inv.payment_method?.replace(/_/g, ' ') ?? 'Payment method not set'}
                    {' · '}
                    {new Date(inv.created_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <InvestmentStatusBadge status={inv.status} />
                  {canApprove && inv.status === 'pending' && (
                    <button
                      onClick={() => handleApprove(inv.id)}
                      disabled={approving === inv.id}
                      className="rounded px-3 py-1 text-xs font-semibold bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white transition-colors"
                    >
                      {approving === inv.id ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                </div>
              </div>

              {approveError[inv.id] && (
                <p className="mt-2 text-xs text-red-400">{approveError[inv.id]}</p>
              )}
              {inv.status === 'confirmed' && (
                <p className="mt-2 text-xs font-medium text-green-400">
                  ✓ Token allocation confirmed. Check Audit Log for on-chain transaction hashes.
                </p>
              )}
              {inv.status === 'paid' && (
                <p className="mt-2 text-xs text-orange-300">
                  Payment captured — awaiting on-chain token allocation.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

