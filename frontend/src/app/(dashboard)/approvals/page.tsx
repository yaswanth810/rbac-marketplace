'use client';

/**
 * Approvals / Work Queue page
 *
 * Unified queue for ALL action-roles. What shows depends on permissions:
 *
 *  Compliance Officer  → assets in pending_compliance  (approve/reject)
 *  Legal Officer       → assets in pending_legal        (approve/reject)
 *  Enterprise Admin    → assets in pending_admin        (approve/reject)
 *  Treasury Officer    → assets in 'approved' with no contract (configure+deploy)
 *  Marketplace Manager → assets in 'tokenized' with no listing (create listing)
 *                        + listings in 'draft' (publish)
 *
 * All roles that have no items see a clear "nothing to do" message.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { hasPermission, ASSET_STATUS_LABELS } from '@/lib/permissions';
import { Card } from '@/components/ui/Card';
import { AssetStatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Input';
import { PageSpinner, ErrorMessage, EmptyState } from '@/components/ui/Spinner';

interface Asset {
  id: string;
  name: string;
  asset_type: string;
  status: string;
  created_at: string;
}

interface ApprovalResult { asset: Asset; }

export default function ApprovalsPage() {
  const api  = useApi();
  const { user } = useAuth();
  const perms = user?.permissions ?? [];

  const canApprove   = hasPermission(perms, 'asset.approve');
  const canDeploy    = hasPermission(perms, 'token.deploy');
  const canConfigure = hasPermission(perms, 'token.configure');
  const canList      = hasPermission(perms, 'marketplace.create');
  const canPublish   = hasPermission(perms, 'marketplace.publish');

  // ── Approval queue (Compliance / Legal / Admin) ─────────────────────────────
  const [pendingAssets,  setPendingAssets]  = useState<Asset[]>([]);
  // ── Treasury queue — approved assets without a deployed token ───────────────
  const [treasuryAssets, setTreasuryAssets] = useState<Asset[]>([]);
  // ── Marketplace queue — tokenized assets without a listing ──────────────────
  const [marketAssets,   setMarketAssets]   = useState<Asset[]>([]);

  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState<string | null>(null);

  // Per-row UI state (approval queue)
  const [expandedReject, setExpandedReject] = useState<string | null>(null);
  const [reasons,        setReasons]        = useState<Record<string, string>>({});
  const [actionLoading,  setActionLoading]  = useState<string | null>(null);
  const [actionErrors,   setActionErrors]   = useState<Record<string, string>>({});

  useEffect(() => {
    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const promises: Promise<void>[] = [];

        // 1. Pending approval queue
        if (canApprove) {
          promises.push(
            api.get<Asset[]>('/api/assets', { pending_approval: 'true' })
               .then(setPendingAssets)
               .catch(() => setPendingAssets([]))
          );
        }

        // 2. Treasury queue — all approved assets (Treasury Officer configures + deploys)
        if (canDeploy || canConfigure) {
          promises.push(
            api.get<Asset[]>('/api/assets', { status: 'approved' })
               .then(setTreasuryAssets)
               .catch(() => setTreasuryAssets([]))
          );
        }

        // 3. Marketplace queue — tokenized assets (needs listing/publish)
        if (canList || canPublish) {
          promises.push(
            api.get<Asset[]>('/api/assets', { status: 'tokenized' })
               .then(setMarketAssets)
               .catch(() => setMarketAssets([]))
          );
        }

        await Promise.all(promises);
      } catch (e: unknown) {
        setFetchError(e instanceof Error ? e.message : 'Failed to load queue.');
      } finally {
        setLoading(false);
      }
    }
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApprove(id: string) {
    setActionLoading(id);
    setActionErrors(p => ({ ...p, [id]: '' }));
    try {
      await api.post<ApprovalResult>(`/api/assets/${id}/approve`, {});
      setPendingAssets(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Approval failed.';
      setActionErrors(p => ({ ...p, [id]: msg }));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string) {
    const reason = reasons[id]?.trim();
    if (!reason) { setActionErrors(p => ({ ...p, [id]: 'A reason is required.' })); return; }
    setActionLoading(id);
    setActionErrors(p => ({ ...p, [id]: '' }));
    try {
      await api.post(`/api/assets/${id}/reject`, { reason });
      setPendingAssets(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Rejection failed.';
      setActionErrors(p => ({ ...p, [id]: msg }));
    } finally {
      setActionLoading(null);
    }
  }

  const hasAnything = pendingAssets.length > 0 || treasuryAssets.length > 0 || marketAssets.length > 0;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold text-white">My Work Queue</h1>

      {loading && <PageSpinner />}
      {fetchError && <ErrorMessage message={fetchError} />}

      {!loading && !fetchError && !hasAnything && (
        <EmptyState message="Nothing needs your action right now." />
      )}

      {/* ── Section 1: Approval queue (Compliance / Legal / Admin) ──────────── */}
      {!loading && canApprove && pendingAssets.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Pending Approval
          </h2>
          <div className="space-y-3">
            {pendingAssets.map(asset => (
              <Card key={asset.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/assets/${asset.id}`} className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors">
                      {asset.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-400 capitalize">
                      {asset.asset_type.replace(/_/g, ' ')} · {new Date(asset.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <AssetStatusBadge status={asset.status} />
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Stage: <span className="text-gray-300">{ASSET_STATUS_LABELS[asset.status] ?? asset.status}</span>
                </p>
                {actionErrors[asset.id] && <ErrorMessage message={actionErrors[asset.id]!} className="mt-3" />}
                <div className="mt-4 flex items-center gap-2">
                  <Button size="sm" onClick={() => handleApprove(asset.id)} loading={actionLoading === asset.id} disabled={!!actionLoading}>
                    Approve
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setExpandedReject(expandedReject === asset.id ? null : asset.id)} disabled={!!actionLoading}>
                    {expandedReject === asset.id ? 'Cancel' : 'Reject'}
                  </Button>
                </div>
                {expandedReject === asset.id && (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      label="Rejection reason"
                      value={reasons[asset.id] ?? ''}
                      onChange={e => setReasons(p => ({ ...p, [asset.id]: e.target.value }))}
                      placeholder="Provide a clear reason for rejection…"
                      required
                    />
                    <Button size="sm" variant="danger" onClick={() => handleReject(asset.id)} loading={actionLoading === asset.id} disabled={!!actionLoading}>
                      Confirm Rejection
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 2: Treasury queue ─────────────────────────────────────────── */}
      {!loading && (canDeploy || canConfigure) && treasuryAssets.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Token Configuration &amp; Deployment
          </h2>
          <div className="space-y-3">
            {treasuryAssets.map(asset => (
              <Card key={asset.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/assets/${asset.id}`} className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors">
                      {asset.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-400 capitalize">
                      {asset.asset_type.replace(/_/g, ' ')} · {new Date(asset.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <AssetStatusBadge status={asset.status} />
                </div>
                <p className="mt-2 text-xs text-indigo-300 bg-indigo-900/20 border border-indigo-700/30 rounded px-3 py-2">
                  This asset is approved and ready for token configuration and on-chain deployment.
                  Open the asset to configure the token symbol, supply, and chain, then deploy.
                </p>
                <div className="mt-3">
                  <Link href={`/assets/${asset.id}`}>
                    <Button size="sm">Open Asset →</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Section 3: Marketplace queue ─────────────────────────────────────── */}
      {!loading && (canList || canPublish) && marketAssets.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Ready to List
          </h2>
          <div className="space-y-3">
            {marketAssets.map(asset => (
              <Card key={asset.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <Link href={`/assets/${asset.id}`} className="text-sm font-semibold text-white hover:text-indigo-300 transition-colors">
                      {asset.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-400 capitalize">
                      {asset.asset_type.replace(/_/g, ' ')} · {new Date(asset.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <AssetStatusBadge status={asset.status} />
                </div>
                <p className="mt-2 text-xs text-green-300 bg-green-900/20 border border-green-700/30 rounded px-3 py-2">
                  Token is deployed. Create a marketplace listing then publish it to make this asset
                  visible to investors in the Marketplace.
                </p>
                <div className="mt-3">
                  <Link href={`/assets/${asset.id}`}>
                    <Button size="sm">Open Asset →</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
