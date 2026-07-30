'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useApi, ApiError } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { hasPermission } from '@/lib/permissions';
import { Card, CardHeader } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { PageSpinner, ErrorMessage } from '@/components/ui/Spinner';

interface AssetDocument {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

function getDocuments(metadata: Record<string, unknown> | null): AssetDocument[] {
  if (!metadata) return [];
  const docs = metadata['documents'];
  if (!Array.isArray(docs)) return [];
  return docs as AssetDocument[];
}

interface Listing {
  id: string;
  asset_id: string;
  status: string;
  published_at: string | null;
  asset_name: string;
  asset_type: string;
  description: string | null;
  currency: string | null;
  total_value: string | null;
  metadata: Record<string, unknown>;
  issuer_id: string;
  token_symbol: string | null;
  token_price: string | null;
  token_supply: string | null;
}

const PAYMENT_METHODS = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'card', label: 'Card' },
  { value: 'stablecoin', label: 'Stablecoin' },
];

export default function MarketplaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canInvest = hasPermission(permissions, 'investment.create');

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Invest form
  const [showInvest, setShowInvest] = useState(false);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('bank_transfer');
  const [investLoading, setInvestLoading] = useState(false);
  const [investError, setInvestError] = useState<string | null>(null);
  const [investSuccess, setInvestSuccess] = useState(false);

  useEffect(() => {
    // Fetch all listings and find by id (no dedicated GET /api/marketplace/:id endpoint)
    api.get<Listing[]>('/api/marketplace')
      .then((all) => {
        const found = all.find((l) => l.id === id);
        if (!found) setError('Listing not found.');
        else setListing(found);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleInvest(e: React.FormEvent) {
    e.preventDefault();
    if (!listing || !amount) return;
    setInvestError(null);
    setInvestLoading(true);
    try {
      await api.post('/api/investments', {
        assetId: listing.asset_id,
        amount: Number(amount),
        paymentMethod,
      });
      setInvestSuccess(true);
      setShowInvest(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setInvestError('Your KYC verification is not yet approved. Contact your administrator.');
      } else {
        setInvestError(err instanceof Error ? err.message : 'Investment failed.');
      }
    } finally {
      setInvestLoading(false);
    }
  }

  if (loading) return <PageSpinner />;
  if (error) return (
    <div>
      <Link href="/marketplace" className="text-sm text-indigo-400 hover:underline">← Back</Link>
      <ErrorMessage message={error} className="mt-4" />
    </div>
  );
  if (!listing) return null;

  const docs = getDocuments(listing.metadata);
  const coverImage = docs.find((d) => d.type?.startsWith('image/'));
  const otherDocs  = docs.filter((d) => !d.type?.startsWith('image/'));

  return (
    <div className="max-w-2xl">
      <Link href="/marketplace" className="mb-6 inline-block text-sm text-indigo-400 hover:underline">
        ← Back to Marketplace
      </Link>

      {/* Cover image hero */}
      {coverImage && (
        <div className="mb-5 overflow-hidden rounded-xl border border-gray-700">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverImage.dataUrl}
            alt={listing.asset_name}
            className="h-64 w-full object-cover"
          />
        </div>
      )}

      <Card>
        <CardHeader
          title={listing.asset_name}
          subtitle={listing.asset_type.replace(/_/g, ' ')}
        />

        {listing.description && (
          <p className="mb-4 text-sm text-gray-300">{listing.description}</p>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm">
          {listing.currency && (
            <div><span className="text-gray-500">Currency</span><p className="text-white">{listing.currency}</p></div>
          )}
          {listing.total_value && (
            <div>
              <span className="text-gray-500">Total Value</span>
              <p className="text-white">{Number(listing.total_value).toLocaleString()} {listing.currency}</p>
            </div>
          )}
          {listing.token_symbol && (
            <div><span className="text-gray-500">Token</span><p className="text-white">{listing.token_symbol}</p></div>
          )}
          {listing.token_price && (
            <div>
              <span className="text-gray-500">Token Price</span>
              <p className="text-white">{listing.token_price} {listing.currency}</p>
            </div>
          )}
          {listing.token_supply && (
            <div>
              <span className="text-gray-500">Total Supply</span>
              <p className="text-white">{Number(listing.token_supply).toLocaleString()} {listing.token_symbol}</p>
            </div>
          )}
          {listing.published_at && (
            <div>
              <span className="text-gray-500">Listed</span>
              <p className="text-white">{new Date(listing.published_at).toLocaleDateString()}</p>
            </div>
          )}
        </div>

        {/* Documents section */}
        {otherDocs.length > 0 && (
          <div className="mt-6 border-t border-gray-700 pt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Documents</p>
            <div className="space-y-2">
              {otherDocs.map((doc, i) => (
                <a
                  key={i}
                  href={doc.dataUrl}
                  download={doc.name}
                  className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2 text-xs text-gray-300 hover:border-indigo-600 hover:text-white transition-colors"
                >
                  <span className="text-lg">{doc.type === 'application/pdf' ? '📄' : '📎'}</span>
                  <span className="flex-1 truncate">{doc.name}</span>
                  <span className="text-gray-500">{(doc.size / 1024).toFixed(1)} KB</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Invest section */}
        {canInvest && (
          <div className="mt-6 border-t border-gray-700 pt-6">
            {investSuccess ? (
              <p className="text-sm font-medium text-green-400">
                ✓ Investment submitted successfully. View status in your portfolio.
              </p>
            ) : (
              <>
                {!showInvest ? (
                  <Button onClick={() => setShowInvest(true)}>Invest Now</Button>
                ) : (
                  <form onSubmit={handleInvest} className="space-y-3">
                    <Input
                      label="Investment Amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="10000"
                      hint={listing.currency ? `In ${listing.currency}` : undefined}
                      required
                    />
                    <Select
                      label="Payment Method"
                      options={PAYMENT_METHODS}
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                    />
                    {investError && <ErrorMessage message={investError} />}
                    <div className="flex gap-2">
                      <Button type="submit" loading={investLoading}>Confirm Investment</Button>
                      <Button variant="ghost" type="button" onClick={() => setShowInvest(false)}>Cancel</Button>
                    </div>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
