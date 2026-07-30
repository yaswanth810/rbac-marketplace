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
  // Enriched
  asset_name: string | null;
  token_symbol: string | null;
  token_decimals: number | null;
  token_price: string | null;
  mint_tx_hash: string | null;
  whitelist_tx_hash: string | null;
  token_amount: string | null;
}

function formatTokens(weiStr: string | null, decimals: number | null, symbol: string | null): string {
  if (!weiStr || decimals == null) return '—';
  try {
    const whole = BigInt(weiStr) / (10n ** BigInt(decimals));
    return `${Number(whole).toLocaleString()} ${symbol ?? 'tokens'}`;
  } catch {
    return '—';
  }
}

function shortHash(hash: string | null): string {
  if (!hash) return '—';
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io/tx';

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

  // Portfolio summary stats (investor view)
  const totalInvested = investments.reduce((sum, inv) => sum + Number(inv.amount), 0);
  const confirmedCount = investments.filter((i) => i.status === 'confirmed').length;
  const pendingCount = investments.filter((i) => i.status === 'pending').length;

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-white">{pageTitle}</h1>

      {/* Wallet connect card — investor only */}
      {isInvestor && (
        <Card className="mb-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Your Wallet</h2>
          <p className="text-xs text-gray-500 mb-4">
            Connect your MetaMask wallet so tokens can be minted to your address when your investment is approved.
          </p>
          <WalletConnect />
        </Card>
      )}

      {/* Portfolio summary — investor only, after load */}
      {isInvestor && !loading && investments.length > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
            <p className="text-xs text-gray-400 mb-1">Total Invested</p>
            <p className="text-lg font-semibold text-white">${totalInvested.toLocaleString()}</p>
          </div>
          <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
            <p className="text-xs text-gray-400 mb-1">Confirmed</p>
            <p className="text-lg font-semibold text-green-400">{confirmedCount}</p>
          </div>
          <div className="rounded-lg bg-gray-800 border border-gray-700 p-4">
            <p className="text-xs text-gray-400 mb-1">Pending</p>
            <p className="text-lg font-semibold text-yellow-400">{pendingCount}</p>
          </div>
        </div>
      )}

      {loading && <PageSpinner />}
      {error && <ErrorMessage message={error} />}
      {!loading && !error && investments.length === 0 && <EmptyState message={emptyMsg} />}

      {!loading && !error && investments.length > 0 && (
        <div className="space-y-4">
          {investments.map((inv) => {
            const tokenStr = formatTokens(inv.token_amount, inv.token_decimals, inv.token_symbol);
            const hasMintTx = !!inv.mint_tx_hash;

            return (
              <Card key={inv.id}>
                {/* Header row */}
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-base font-semibold text-white">
                      {inv.asset_name ?? `Asset ${inv.asset_id.slice(0, 8)}…`}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {inv.payment_method?.replace(/_/g, ' ') ?? 'Payment method not set'}
                      {' · '}
                      {new Date(inv.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
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

                {/* Key figures */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
                  <div>
                    <p className="text-xs text-gray-500">Investment Amount</p>
                    <p className="text-sm font-semibold text-white mt-0.5">
                      ${Number(inv.amount).toLocaleString()}
                    </p>
                  </div>
                  {inv.token_symbol && (
                    <div>
                      <p className="text-xs text-gray-500">Token Price</p>
                      <p className="text-sm font-semibold text-white mt-0.5">
                        ${Number(inv.token_price ?? 0).toFixed(2)} / {inv.token_symbol}
                      </p>
                    </div>
                  )}
                  {inv.token_amount && (
                    <div>
                      <p className="text-xs text-gray-500">Tokens Allocated</p>
                      <p className="text-sm font-semibold text-green-400 mt-0.5">{tokenStr}</p>
                    </div>
                  )}
                </div>

                {/* On-chain receipts */}
                {hasMintTx && (
                  <div className="mt-3 pt-3 border-t border-gray-700 space-y-1.5">
                    <p className="text-xs font-medium text-gray-400 mb-1">On-Chain Transactions</p>
                    {inv.whitelist_tx_hash && (
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-500">Whitelist TX</span>
                        <a
                          href={`${SEPOLIA_EXPLORER}/${inv.whitelist_tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-mono text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          {shortHash(inv.whitelist_tx_hash)} ↗
                        </a>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Mint TX</span>
                      <a
                        href={`${SEPOLIA_EXPLORER}/${inv.mint_tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-mono text-green-400 hover:text-green-300 hover:underline"
                      >
                        {shortHash(inv.mint_tx_hash)} ↗
                      </a>
                    </div>
                    <p className="text-xs text-green-400 mt-1">
                      ✓ Token allocation confirmed on Sepolia
                    </p>
                  </div>
                )}

                {/* Error */}
                {approveError[inv.id] && (
                  <p className="mt-2 text-xs text-red-400">{approveError[inv.id]}</p>
                )}

                {/* Pending / paid guidance */}
                {inv.status === 'pending' && !canApprove && (
                  <p className="mt-2 text-xs text-yellow-400">
                    ⏳ Awaiting Marketplace Manager approval
                  </p>
                )}
                {inv.status === 'paid' && (
                  <p className="mt-2 text-xs text-orange-300">
                    💳 Payment captured — awaiting on-chain token allocation
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
