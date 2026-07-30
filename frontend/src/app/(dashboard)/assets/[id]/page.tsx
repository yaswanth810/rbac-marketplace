'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { hasPermission } from '@/lib/permissions';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { AssetStatusBadge } from '@/components/ui/Badge';
import { PageSpinner, ErrorMessage } from '@/components/ui/Spinner';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Asset {
  id: string;
  name: string;
  asset_type: string;
  description: string | null;
  status: string;
  issuer_id: string;
  jurisdiction: string | null;
  currency: string | null;
  total_value: string | null;
  metadata: {
    documents?: Array<{
      name: string;
      type: string;
      size: number;
      dataUrl: string;
      uploadedAt: string;
    }>;
    [key: string]: unknown;
  } | null;
  created_at: string;
  organization_id: string;
}

interface ApprovalRow {
  id: string;
  stage: string;
  approver_name: string | null;
  decision: string;
  comment: string | null;
  created_at: string;
}

interface TokenRow {
  id: string;
  asset_id: string;
  contract_address: string | null;
  token_symbol: string;
  total_supply: string | null;
  decimals: number;
  price: string | null;
  chain_id: number;
}

interface TokenConfig {
  token_symbol: string;
  total_supply: string;
  decimals: string;
  price: string;
  chain_id: string;
}

interface ListingRow {
  id: string;
  asset_id: string;
  status: string; // 'draft' | 'published' | 'closed'
  published_at: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Only chains with matching env vars in backend/.env are supported.
// chain_id 31337  → BLOCKCHAIN_RPC_URL + DEPLOYER_PRIVATE_KEY       (always funded on Hardhat)
// chain_id 11155111 → SEPOLIA_RPC_URL + SEPOLIA_DEPLOYER_PRIVATE_KEY (needs real Sepolia ETH)
// The backend selects the correct provider per chain and checks balance before deploying to Sepolia.
const CHAIN_IDS = [
  { value: '31337',    label: 'Localhost Hardhat (31337)' },
  { value: '11155111', label: 'Sepolia Testnet (11155111)' },
];

const STAGE_LABELS: Record<string, string> = {
  pending_compliance: 'Compliance Review',
  pending_legal:      'Legal Review',
  pending_admin:      'Admin Approval',
};

const DECISION_STYLES: Record<string, string> = {
  approved: 'bg-green-900/50 text-green-300 border border-green-700/40',
  rejected: 'bg-red-900/50 text-red-300 border border-red-700/40',
  pending:  'bg-yellow-900/50 text-yellow-300 border border-yellow-700/40',
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AssetDetailPage() {
  const { id }     = useParams<{ id: string }>();
  const api        = useApi();
  const router     = useRouter();
  const { user }   = useAuth();
  const perms      = user?.permissions ?? [];

  // ── Data state ───────────────────────────────────────────────────────────────
  const [asset,     setAsset]     = useState<Asset | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [token,     setToken]     = useState<TokenRow | null | 'none'>('none');
  const [listing,   setListing]   = useState<ListingRow | null | 'none'>('none');
  const [pageError, setPageError] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);

  // ── Action state ─────────────────────────────────────────────────────────────
  const [actionError,   setActionError]   = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Token configure form
  const [tokenForm, setTokenForm] = useState<TokenConfig>({
    token_symbol: '', total_supply: '', decimals: '18', price: '', chain_id: '31337',
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const canSubmit      = hasPermission(perms, 'asset.submit');
  const canConfigure   = hasPermission(perms, 'token.configure');
  const canDeploy      = hasPermission(perms, 'token.deploy');
  const canMint        = hasPermission(perms, 'token.mint');
  const canCreateList  = hasPermission(perms, 'marketplace.create');
  const canPublishList = hasPermission(perms, 'marketplace.publish');

  // ── Fetch ────────────────────────────────────────────────────────────────────

  async function fetchAll() {
    setLoading(true);
    setPageError(null);
    try {
      const [assetData, approvalsData] = await Promise.all([
        api.get<Asset>(`/api/assets/${id}`),
        api.get<ApprovalRow[]>(`/api/assets/${id}/approvals`),
      ]);
      setAsset(assetData);
      setApprovals(approvalsData);

      // Always fetch token for pipeline display (404 = not yet configured)
      try {
        const tokenData = await api.get<TokenRow>(`/api/tokens/${id}`);
        setToken(tokenData);
      } catch {
        setToken(null); // 404 expected — token not configured yet
      }

      // Always fetch listing for pipeline display (empty array = no listing yet)
      try {
        const listings = await api.get<ListingRow[]>('/api/marketplace/listings', { assetId: id });
        setListing(listings[0] ?? null);
      } catch {
        setListing(null);
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Failed to load asset.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  async function handleSubmit() {
    setActionError(null);
    setActionLoading(true);
    try {
      const updated = await api.post<Asset>(`/api/assets/${id}/submit`, {});
      setAsset(updated);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit asset.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfigureToken(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    if (!tokenForm.token_symbol.trim() || !tokenForm.total_supply || !tokenForm.chain_id) {
      setActionError('Token Symbol, Total Supply, and Chain are required.');
      return;
    }
    setActionLoading(true);
    try {
      await api.post('/api/tokens/configure', {
        assetId:     id,
        tokenSymbol: tokenForm.token_symbol.trim().toUpperCase(),
        totalSupply: Number(tokenForm.total_supply),
        decimals:    Number(tokenForm.decimals) || 18,
        price:       tokenForm.price ? Number(tokenForm.price) : undefined,
        chainId:     Number(tokenForm.chain_id),
      });
      // Re-fetch token row
      const tokenData = await api.get<TokenRow>(`/api/tokens/${id}`);
      setToken(tokenData);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to configure token.');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeployToken() {
    setActionError(null);
    setActionLoading(true);
    try {
      const tokenData = await api.post<TokenRow>('/api/tokens/deploy', { assetId: id });
      // Update token state immediately from the response (has contract_address)
      setToken(tokenData);
      // Re-fetch asset to get the updated status ('tokenized') — isolated so a
      // fetch failure here doesn't hide the successful deploy result above.
      try {
        const assetData = await api.get<Asset>(`/api/assets/${id}`);
        setAsset(assetData);
      } catch {
        // Non-fatal: token was deployed, page will reflect it. User can refresh.
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to deploy token.');
    } finally {
      setActionLoading(false);
    }
  }

  // Mint: recipient is locked to the deployer/admin wallet (the address passed
  // as admin_ in the RWAToken constructor), which is the only wallet guaranteed
  // to be whitelisted at this point. Minting to arbitrary addresses without
  // going through the investment approval flow (which handles whitelist + mint
  // atomically) would fail with 409 "not whitelisted" or create an inconsistent
  // second mint path. Investors receive tokens via POST /api/investments/:id/approve.
  const [mintAmount, setMintAmount]   = useState('');
  const [mintRecipientId, setMintRecipientId] = useState('');

  async function handleMint(e: FormEvent) {
    e.preventDefault();
    setActionError(null);
    if (!mintAmount || !mintRecipientId) {
      setActionError('Recipient User ID and amount are required.');
      return;
    }
    setActionLoading(true);
    try {
      await api.post('/api/tokens/mint', {
        assetId:         id,
        recipientUserId: mintRecipientId,
        amount:          mintAmount,
      });
      setMintAmount('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Mint failed.');
    } finally {
      setActionLoading(false);
    }
  }

  // ── Loading / error states ────────────────────────────────────────────────────

  if (loading) return <PageSpinner />;
  if (pageError || !asset) return <ErrorMessage message={pageError ?? 'Asset not found.'} />;

  // Derived booleans
  const isTokenConfigured = token !== 'none' && token !== null;
  const isDeployed        = isTokenConfigured && !!(token as TokenRow).contract_address;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <Link href="/assets" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
          ← Back to Assets
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-white">{asset.name}</h1>
            <p className="mt-1 text-xs text-gray-500">
              {asset.asset_type.replace(/_/g, ' ')} · Created {new Date(asset.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <AssetStatusBadge status={asset.status} />
            {asset.status === 'draft' && canSubmit && (
              <Button onClick={handleSubmit} loading={actionLoading} size="sm">
                Submit for Review
              </Button>
            )}
          </div>
        </div>
        {actionError && <ErrorMessage message={actionError} className="mt-3" />}
      </div>

      {/* ── Asset Details ───────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Asset Details</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {[
            ['Description',  asset.description    ?? '—'],
            ['Jurisdiction', asset.jurisdiction   ?? '—'],
            ['Currency',     asset.currency       ?? '—'],
            ['Total Value',  asset.total_value
              ? `${asset.currency ?? ''} ${Number(asset.total_value).toLocaleString()}`
              : '—'],
            ['Asset ID',     asset.id],
          ].map(([label, val]) => (
            <div key={label}>
              <dt className="text-xs text-gray-500 uppercase tracking-wide">{label}</dt>
              <dd className="mt-0.5 text-gray-200 break-all">{val}</dd>
            </div>
          ))}
        </dl>

        {/* Documents */}
        {(asset.metadata?.documents?.length ?? 0) > 0 && (
          <div className="mt-5 border-t border-gray-700 pt-4">
            <p className="text-xs font-medium text-gray-400 mb-3 uppercase tracking-wide">Uploaded Documents</p>
            <ul className="space-y-2">
              {asset.metadata!.documents!.map((doc, i) => (
                <li key={i} className="flex items-center gap-3 rounded-md bg-gray-800/60 px-3 py-2">
                  {doc.type.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={doc.dataUrl} alt={doc.name} className="h-10 w-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <span className="text-2xl flex-shrink-0">📄</span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm text-gray-200">{doc.name}</p>
                    <p className="text-xs text-gray-500">{formatBytes(doc.size)}</p>
                  </div>
                  <a
                    href={doc.dataUrl}
                    download={doc.name}
                    className="text-xs text-indigo-400 hover:text-indigo-200 flex-shrink-0"
                  >Download</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ── Approval History ────────────────────────────────────────────────── */}
      <Card>
        <h2 className="text-sm font-semibold text-gray-300 mb-4">Approval History</h2>
        {approvals.length === 0 ? (
          <p className="text-sm text-gray-500">
            No approvals recorded yet.
            {asset.status === 'draft' && ' Submit the asset for review to start the approval workflow.'}
          </p>
        ) : (
          <ol className="space-y-3">
            {approvals.map((a) => (
              <li key={a.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className={`mt-1 h-2.5 w-2.5 rounded-full flex-shrink-0 ${
                    a.decision === 'approved' ? 'bg-green-500' :
                    a.decision === 'rejected' ? 'bg-red-500'   : 'bg-yellow-500'
                  }`} />
                  <div className="flex-1 w-px bg-gray-700 mt-1" />
                </div>
                <div className="pb-3 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-200">
                      {STAGE_LABELS[a.stage] ?? a.stage}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${DECISION_STYLES[a.decision] ?? ''}`}>
                      {a.decision}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {a.approver_name ?? 'Unknown'} · {new Date(a.created_at).toLocaleString()}
                  </p>
                  {a.comment && (
                    <p className="mt-1 text-sm text-gray-400 italic">&ldquo;{a.comment}&rdquo;</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {/* ── Pipeline Status Banner ────────────────────────────────────────────── */}
      {/* Always visible for any user once the asset is approved.               */}
      {/* Shows the full flow and highlights where we are.                      */}
      {['approved', 'tokenized', 'listed'].includes(asset.status) && (() => {
        // token/listing state after fetchAll:
        //   'none'  = not yet fetched (shouldn't happen post-load)
        //   null    = fetched, doesn't exist
        //   object  = fetched and exists
        const tokenFetched  = token !== 'none';
        const listingFetched = listing !== 'none';
        const tokenExists    = tokenFetched && token !== null;
        const tokenDeployed  = tokenExists && !!(token as TokenRow).contract_address;
        const listingExists  = listingFetched && listing !== null;
        const listingDraft   = listingExists && (listing as ListingRow).status === 'draft';

        const steps = [
          {
            key: 'approved',
            label: 'Approved',
            role: null as string | null,
            done: true,
            active: false,
          },
          {
            key: 'configure',
            label: 'Configure Token',
            role: 'Treasury Officer',
            done: tokenExists || ['tokenized', 'listed'].includes(asset.status),
            active: asset.status === 'approved' && !tokenExists,
          },
          {
            key: 'deploy',
            label: 'Deploy Token',
            role: 'Treasury Officer',
            done: tokenDeployed || ['tokenized', 'listed'].includes(asset.status),
            active: asset.status === 'approved' && tokenExists && !tokenDeployed,
          },
          {
            key: 'list',
            label: 'Create Listing',
            role: 'Marketplace Manager',
            done: listingExists || asset.status === 'listed',
            active: asset.status === 'tokenized' && !listingExists,
          },
          {
            key: 'publish',
            label: 'Publish',
            role: 'Marketplace Manager',
            done: asset.status === 'listed',
            active: asset.status === 'tokenized' && listingDraft,
          },
        ];

        const activeStep = steps.find(s => s.active);

        return (
          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Pipeline</p>
            <ol className="flex items-center gap-0 overflow-x-auto pb-1">
              {steps.map((step, i) => (
                <li key={step.key} className="flex items-center flex-shrink-0">
                  <div className="flex flex-col items-center gap-1">
                    <div className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                      step.done
                        ? 'bg-green-500 border-green-400 text-white'
                        : step.active
                        ? 'bg-indigo-600 border-indigo-400 text-white animate-pulse'
                        : 'bg-gray-800 border-gray-600 text-gray-500'
                    }`}>
                      {step.done ? '✓' : i + 1}
                    </div>
                    <span className={`text-xs whitespace-nowrap ${
                      step.done ? 'text-green-400' : step.active ? 'text-indigo-300 font-medium' : 'text-gray-600'
                    }`}>
                      {step.label}
                    </span>
                    {step.role && (
                      <span className="text-[10px] text-gray-600 whitespace-nowrap">{step.role}</span>
                    )}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`h-px w-8 mx-1 mb-5 flex-shrink-0 ${step.done ? 'bg-green-600' : 'bg-gray-700'}`} />
                  )}
                </li>
              ))}
            </ol>
            {activeStep && (
              <p className="mt-3 text-xs text-indigo-300 bg-indigo-900/20 border border-indigo-700/30 rounded-md px-3 py-2">
                ⏭ Next:{' '}
                <span className="font-medium">{activeStep.label}</span>
                {activeStep.role && (
                  <span className="text-gray-400"> — requires <span className="text-white">{activeStep.role}</span> role</span>
                )}
              </p>
            )}
          </div>
        );
      })()}

      {/* ── Token Operations (gated on status + permissions) ─────────────────── */}

      {/* Configure Token — only when approved and not yet configured */}
      {asset.status === 'approved' && canConfigure && !isTokenConfigured && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Configure Token</h2>
          <p className="text-xs text-gray-500 mb-4">
            The asset is approved. Define the ERC-20 token parameters before deployment.
          </p>
          <form onSubmit={handleConfigureToken} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Token Symbol"
                value={tokenForm.token_symbol}
                onChange={(e) => setTokenForm({ ...tokenForm, token_symbol: e.target.value.toUpperCase() })}
                placeholder="GBOND"
                required
                maxLength={8}
              />
              <Input
                label="Total Supply"
                type="number"
                min="1"
                value={tokenForm.total_supply}
                onChange={(e) => setTokenForm({ ...tokenForm, total_supply: e.target.value })}
                placeholder="1000000"
                hint="Whole token units (constructor ×10^decimals)"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Decimals"
                type="number"
                min="0"
                max="18"
                value={tokenForm.decimals}
                onChange={(e) => setTokenForm({ ...tokenForm, decimals: e.target.value })}
                placeholder="18"
              />
              <Input
                label="Price per Token"
                type="number"
                min="0"
                step="0.000001"
                value={tokenForm.price}
                onChange={(e) => setTokenForm({ ...tokenForm, price: e.target.value })}
                placeholder="1.00"
                hint="In asset currency"
              />
            </div>
            <Select
              label="Chain"
              options={CHAIN_IDS}
              value={tokenForm.chain_id}
              onChange={(e) => setTokenForm({ ...tokenForm, chain_id: e.target.value })}
              required
            />
            {tokenForm.chain_id === '11155111' && (
              <div className="rounded-md bg-yellow-900/20 border border-yellow-700/30 px-3 py-2.5">
                <p className="text-xs text-yellow-300 font-medium mb-1">⚠️ Sepolia deployment requirements</p>
                <ul className="text-xs text-yellow-200/80 space-y-0.5 list-disc list-inside">
                  <li><span className="font-mono">SEPOLIA_RPC_URL</span> must be set in <span className="font-mono">backend/.env</span></li>
                  <li><span className="font-mono">SEPOLIA_DEPLOYER_PRIVATE_KEY</span> must hold ≥ 0.01 Sepolia ETH</li>
                  <li>
                    Get free ETH:{' '}
                    <a href="https://sepoliafaucet.com" target="_blank" rel="noreferrer" className="underline">sepoliafaucet.com</a>
                    {' '}or{' '}
                    <a href="https://faucet.quicknode.com/ethereum/sepolia" target="_blank" rel="noreferrer" className="underline">QuickNode faucet</a>
                  </li>
                  <li>The backend checks balance before deploying and returns a clear error if unfunded.</li>
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <Button type="submit" loading={actionLoading}>Configure Token</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Deploy Token — token configured but not yet deployed */}
      {asset.status === 'approved' && canDeploy && isTokenConfigured && !isDeployed && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Deploy Token</h2>
          <p className="text-xs text-gray-500 mb-4">
            Token configured as{' '}
            <span className="font-mono text-indigo-300">{(token as TokenRow).token_symbol}</span>
            {' '}· supply {Number((token as TokenRow).total_supply ?? 0).toLocaleString()}
            {' '}· {(token as TokenRow).decimals} decimals.
            Deploying will create an ERC-20 smart contract on-chain and set asset status to{' '}
            <span className="font-mono">tokenized</span>.
          </p>
          <div className="rounded-md bg-yellow-900/20 border border-yellow-700/30 px-4 py-3 mb-4">
            <p className="text-xs text-yellow-300">
              ⚠️  Deployment is irreversible. The contract address will be stored on-chain and in the database.
            </p>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleDeployToken} loading={actionLoading} variant="primary">
              Deploy Token On-Chain
            </Button>
          </div>
        </Card>
      )}

      {/* Token Info (post-deploy) */}
      {isDeployed && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-300 mb-4">Token</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[
              ['Symbol',           (token as TokenRow).token_symbol],
              ['Total Supply',     Number((token as TokenRow).total_supply ?? 0).toLocaleString()],
              ['Decimals',         String((token as TokenRow).decimals)],
              ['Price',            (token as TokenRow).price ? `${asset.currency ?? ''} ${(token as TokenRow).price}` : '—'],
              ['Chain ID',         String((token as TokenRow).chain_id)],
              ['Contract Address', (token as TokenRow).contract_address ?? '—'],
            ].map(([label, val]) => (
              <div key={label}>
                <dt className="text-xs text-gray-500 uppercase tracking-wide">{label}</dt>
                <dd className="mt-0.5 text-gray-200 font-mono text-xs break-all">{val}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* Mint Tokens — only when tokenized and user has token.mint */}
      {asset.status === 'tokenized' && canMint && isDeployed && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Mint Tokens</h2>
          <p className="text-xs text-gray-500 mb-4">
            Mint tokens to a whitelisted wallet. The recipient must already be whitelisted on-chain.
            Investors are whitelisted + minted automatically when their investment is approved.
            Use this card to mint to the admin wallet (whitelisted by constructor) for initial distribution.
          </p>
          <form onSubmit={handleMint} className="space-y-4">
            <Input
              label="Recipient User ID"
              value={mintRecipientId}
              onChange={(e) => setMintRecipientId(e.target.value)}
              placeholder="UUID of a user with a registered wallet address"
              hint="Their wallet must already be whitelisted on-chain"
              required
            />
            <Input
              label="Amount (wei)"
              value={mintAmount}
              onChange={(e) => setMintAmount(e.target.value)}
              placeholder="e.g. 1000000000000000000 for 1 token (18 decimals)"
              hint={`100 tokens = ${100}${'0'.repeat((token as TokenRow).decimals)} wei`}
              required
            />
            <div className="flex justify-end">
              <Button type="submit" loading={actionLoading}>Mint</Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Marketplace Listing ─────────────────────────────────────────────── */}

      {/* Create Listing — asset tokenized, no listing yet, user can create */}
      {['tokenized', 'listed'].includes(asset.status) &&
        canCreateList &&
        listing === null && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Create Marketplace Listing</h2>
          <p className="text-xs text-gray-500 mb-4">
            The token is deployed. Create a listing to make this asset available in the marketplace.
            The listing starts in <span className="font-mono">draft</span> state — publish it to make it visible to investors.
          </p>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                setActionError(null);
                setActionLoading(true);
                try {
                  const created = await api.post<ListingRow>('/api/marketplace/listings', { assetId: id });
                  setListing(created);
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : 'Failed to create listing.');
                } finally {
                  setActionLoading(false);
                }
              }}
              loading={actionLoading}
            >
              Create Listing
            </Button>
          </div>
        </Card>
      )}

      {/* Publish Listing — listing exists in draft, user can publish */}
      {listing !== null && listing !== 'none' &&
        (listing as ListingRow).status === 'draft' &&
        canPublishList && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-300 mb-1">Publish Listing</h2>
          <p className="text-xs text-gray-500 mb-4">
            The listing is in <span className="font-mono">draft</span> state. Publishing will make it visible
            to all investors in the marketplace and set the asset status to{' '}
            <span className="font-mono">listed</span>.
          </p>
          <div className="flex justify-end">
            <Button
              onClick={async () => {
                setActionError(null);
                setActionLoading(true);
                try {
                  const listingId = (listing as ListingRow).id;
                  await api.post(`/api/marketplace/listings/${listingId}/publish`, {});
                  await fetchAll(); // re-fetch — asset status changes to 'listed'
                } catch (err) {
                  setActionError(err instanceof Error ? err.message : 'Failed to publish listing.');
                } finally {
                  setActionLoading(false);
                }
              }}
              loading={actionLoading}
              variant="primary"
            >
              Publish to Marketplace
            </Button>
          </div>
        </Card>
      )}

      {/* Published — show link to marketplace */}
      {asset.status === 'listed' && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-green-300">✓ Live on Marketplace</h2>
              <p className="text-xs text-gray-500 mt-1">This asset is published and visible to investors.</p>
            </div>
            <Link href="/marketplace">
              <Button variant="secondary" size="sm">View in Marketplace →</Button>
            </Link>
          </div>
        </Card>
      )}

    </div>
  );
}
