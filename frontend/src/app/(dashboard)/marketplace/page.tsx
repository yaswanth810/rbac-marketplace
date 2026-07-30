'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { PageSpinner, ErrorMessage, EmptyState } from '@/components/ui/Spinner';

interface AssetDocument {
  name: string;
  type: string;
  size: number;
  dataUrl: string;
}

interface Listing {
  id: string;
  asset_id: string;
  status: string;
  published_at: string | null;
  asset_name: string;
  asset_type: string;
  currency: string | null;
  total_value: string | null;
  token_symbol: string | null;
  token_price: string | null;
  metadata: Record<string, unknown> | null;
}

const ASSET_TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'equity', label: 'Equity' },
  { value: 'bond', label: 'Bond' },
  { value: 'commodity', label: 'Commodity' },
  { value: 'fund', label: 'Fund' },
  { value: 'other', label: 'Other' },
];

/** Extract the first image dataUrl from asset metadata.documents */
function getCoverImage(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const docs = metadata['documents'] as AssetDocument[] | undefined;
  if (!Array.isArray(docs)) return null;
  const img = docs.find((d) => d.type?.startsWith('image/'));
  return img?.dataUrl ?? null;
}

/** Friendly label for asset types */
function assetTypeLabel(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Format currency values */
function formatValue(value: string | null, currency: string | null): string {
  if (!value) return '—';
  const num = Number(value);
  if (isNaN(num)) return value;
  return `${currency ?? ''} ${num.toLocaleString('en-US', { maximumFractionDigits: 0 })}`.trim();
}

export default function MarketplacePage() {
  const api = useApi();

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assetClass, setAssetClass] = useState('');
  const [currency, setCurrency] = useState('');

  function fetchListings() {
    setLoading(true);
    api.get<Listing[]>('/api/marketplace', {
      asset_class: assetClass || undefined,
      currency: currency || undefined,
    })
      .then(setListings)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchListings(); }, []);

  function handleFilter(e: React.FormEvent) {
    e.preventDefault();
    fetchListings();
  }

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-white">Marketplace</h1>

      {/* Filters */}
      <form onSubmit={handleFilter} className="mb-6 flex items-end gap-3">
        <div className="w-44">
          <Select
            label="Asset Class"
            options={ASSET_TYPE_OPTIONS}
            value={assetClass}
            onChange={(e) => setAssetClass(e.target.value)}
          />
        </div>
        <div className="w-32">
          <Input
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            placeholder="USD"
            maxLength={3}
          />
        </div>
        <button
          type="submit"
          className="mb-0.5 rounded-md border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition-colors"
        >
          Filter
        </button>
        {(assetClass || currency) && (
          <button
            type="button"
            onClick={() => { setAssetClass(''); setCurrency(''); fetchListings(); }}
            className="mb-0.5 text-sm text-gray-500 hover:text-gray-300"
          >
            Clear
          </button>
        )}
      </form>

      {loading && <PageSpinner />}
      {error && <ErrorMessage message={error} />}
      {!loading && !error && listings.length === 0 && (
        <EmptyState message="No published listings found." />
      )}

      {!loading && !error && listings.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {listings.map((listing) => {
            const cover = getCoverImage(listing.metadata);
            return (
              <Link key={listing.id} href={`/marketplace/${listing.id}`}>
                <Card className="cursor-pointer hover:border-indigo-500 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-900/20 h-full flex flex-col overflow-hidden p-0">
                  {/* Cover image */}
                  {cover ? (
                    <div className="relative h-44 w-full overflow-hidden bg-gray-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={cover}
                        alt={listing.asset_name}
                        className="h-full w-full object-cover"
                      />
                      {/* Gradient overlay so text is readable on any image */}
                      <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 to-transparent" />
                      {/* Asset type chip on the image */}
                      <span className="absolute top-3 left-3 rounded-full bg-indigo-600/90 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
                        {assetTypeLabel(listing.asset_type ?? 'Asset')}
                      </span>
                      {listing.currency && (
                        <span className="absolute top-3 right-3 rounded-full bg-gray-900/80 px-2.5 py-0.5 text-[10px] text-gray-300 backdrop-blur-sm">
                          {listing.currency}
                        </span>
                      )}
                    </div>
                  ) : (
                    /* Placeholder when no image */
                    <div className="relative flex h-28 w-full items-center justify-center bg-gradient-to-br from-indigo-900/40 to-gray-800">
                      <span className="text-3xl opacity-50">
                        {listing.asset_type === 'real_estate' ? '🏢'
                         : listing.asset_type === 'bond' ? '📋'
                         : listing.asset_type === 'equity' ? '📈'
                         : listing.asset_type === 'commodity' ? '🥇'
                         : listing.asset_type === 'fund' ? '💼'
                         : '🏷️'}
                      </span>
                      <span className="absolute top-3 left-3 rounded-full bg-indigo-600/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                        {assetTypeLabel(listing.asset_type ?? 'Asset')}
                      </span>
                      {listing.currency && (
                        <span className="absolute top-3 right-3 text-xs text-gray-500">
                          {listing.currency}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Card body */}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <h3 className="text-sm font-semibold leading-snug text-white line-clamp-2">
                      {listing.asset_name}
                    </h3>

                    <div className="mt-auto space-y-1.5 text-xs text-gray-400">
                      {listing.total_value && (
                        <div className="flex items-center justify-between">
                          <span>Total Value</span>
                          <span className="font-medium text-gray-200">
                            {formatValue(listing.total_value, listing.currency)}
                          </span>
                        </div>
                      )}
                      {listing.token_symbol && (
                        <div className="flex items-center justify-between">
                          <span>Token</span>
                          <span className="font-medium text-gray-200">
                            {listing.token_symbol}
                            {listing.token_price && (
                              <span className="ml-1 text-gray-400">
                                @ {Number(listing.token_price).toLocaleString()} {listing.currency}
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-gray-700/50">
                      <span className="text-xs text-gray-500">
                        {listing.published_at
                          ? new Date(listing.published_at).toLocaleDateString()
                          : ''}
                      </span>
                      <span className="text-xs font-medium text-indigo-400">
                        View Details →
                      </span>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
