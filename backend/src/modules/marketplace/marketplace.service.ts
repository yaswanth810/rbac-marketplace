/**
 * marketplace.service.ts
 *
 * Business logic for marketplace listings:
 *   create listing → publish listing → browse published listings
 *
 * Org scoping note
 * ─────────────────
 * marketplace_listings has no organization_id column. Org scope is always
 * derived via: marketplace_listings.asset_id → assets.organization_id
 * Every query that needs an org check JOINS through assets.
 *
 * Audit logging
 * ─────────────
 * Both createListing and publishListing write to audit_logs per spec §12.
 */

import { type PrismaClient, Prisma } from '@prisma/client';
import { AppError } from '../assets/asset.service.js';

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface ListingRow {
  id: string;
  asset_id: string;
  status: string;
  published_at: Date | null;
}

export interface ListingWithAsset extends ListingRow {
  asset_name: string;
  asset_type: string;
  description: string | null;
  currency: string | null;
  total_value: string | null;
  metadata: unknown;
  issuer_id: string;
  organization_id: string;
  token_symbol: string | null;
  token_price: string | null;
  token_supply: string | null;
}

// ── Create listing ────────────────────────────────────────────────────────────

interface CreateListingInput {
  assetId: string;
  organizationId: string;
  userId: string;
}

export async function createListing(
  prisma: PrismaClient,
  input: CreateListingInput
): Promise<ListingRow> {
  const { assetId, organizationId, userId } = input;

  // Verify asset exists, belongs to org, and is 'tokenized'.
  const assetRows = await prisma.$queryRaw<
    Array<{ id: string; organization_id: string; status: string }>
  >(
    Prisma.sql`SELECT id, organization_id, status FROM assets WHERE id = ${assetId}::uuid`
  );
  const asset = assetRows[0];
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'tokenized') {
    throw new AppError(
      409,
      `A marketplace listing can only be created for a 'tokenized' asset (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  // Insert listing (ON CONFLICT DO NOTHING detects duplicates).
  const rows = await prisma.$queryRaw<ListingRow[]>(
    Prisma.sql`
      INSERT INTO marketplace_listings (asset_id)
      VALUES (${assetId}::uuid)
      ON CONFLICT (asset_id) DO NOTHING
      RETURNING id, asset_id, status, published_at
    `
  );

  if (rows.length === 0) {
    throw new AppError(409, 'A listing already exists for this asset.', 'Conflict');
  }

  // Audit log (spec §12 — marketplace publishing events).
  await prisma.$queryRaw(
    Prisma.sql`
      INSERT INTO audit_logs
        (user_id, action, resource_type, resource_id, organization_id, new_state)
      VALUES
        (${userId}::uuid, 'marketplace.create', 'listing', ${rows[0]!.id}::uuid,
         ${organizationId}::uuid,
         ${JSON.stringify({ assetId, status: 'draft' })}::jsonb)
    `
  );

  return rows[0]!;
}

// ── Publish listing ───────────────────────────────────────────────────────────

interface PublishListingInput {
  id: string;
  organizationId: string;
  userId: string;
}

export async function publishListing(
  prisma: PrismaClient,
  input: PublishListingInput
): Promise<ListingRow> {
  const { id, organizationId, userId } = input;

  // Fetch listing and verify org via JOIN to assets.
  const rows = await prisma.$queryRaw<
    Array<{ id: string; asset_id: string; status: string; organization_id: string }>
  >(
    Prisma.sql`
      SELECT ml.id, ml.asset_id, ml.status, a.organization_id
      FROM   marketplace_listings ml
      JOIN   assets               a ON ml.asset_id = a.id
      WHERE  ml.id = ${id}::uuid
    `
  );
  const listing = rows[0];
  if (!listing || listing.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (!['draft', 'unpublished'].includes(listing.status)) {
    throw new AppError(
      409,
      `Only listings in 'draft' or 'unpublished' status can be published (current: '${listing.status}')`,
      'Conflict'
    );
  }

  const previousState = JSON.stringify({ listingStatus: listing.status });
  const newState = JSON.stringify({ listingStatus: 'published', assetStatus: 'listed' });

  // Atomic: update listing, advance asset status, write audit log.
  const [updatedRows] = await prisma.$transaction([
    prisma.$queryRaw<ListingRow[]>(
      Prisma.sql`
        UPDATE marketplace_listings
        SET status = 'published', published_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING id, asset_id, status, published_at
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        UPDATE assets SET status = 'listed' WHERE id = ${listing.asset_id}::uuid
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${userId}::uuid, 'marketplace.publish', 'listing', ${id}::uuid,
           ${organizationId}::uuid,
           ${previousState}::jsonb, ${newState}::jsonb)
      `
    ),
  ]);

  return ((updatedRows as ListingRow[])[0])!;
}

// ── Browse published listings ─────────────────────────────────────────────────

interface ListingFilters {
  assetClass?: string | null;
  issuerId?: string | null;
  currency?: string | null;
  risk?: string | null;
}

export async function listPublishedListings(
  prisma: PrismaClient,
  organizationId: string,
  filters: ListingFilters = {}
): Promise<ListingWithAsset[]> {
  const { assetClass, issuerId, currency, risk } = filters;

  // asset_class maps to assets.asset_type
  // risk      maps to assets.metadata->>'risk_level' (JSONB field)
  // NULL IS NULL is always true, so null params act as "no filter"
  return prisma.$queryRaw<ListingWithAsset[]>(
    Prisma.sql`
      SELECT
        ml.id,
        ml.asset_id,
        ml.status,
        ml.published_at,
        a.name         AS asset_name,
        a.asset_type::text,
        a.description,
        a.currency,
        a.total_value::text AS total_value,
        a.metadata,
        a.issuer_id,
        a.organization_id,
        t.token_symbol,
        t.price::text  AS token_price,
        t.total_supply::text AS token_supply
      FROM   marketplace_listings ml
      JOIN   assets               a  ON ml.asset_id = a.id
      LEFT   JOIN tokens          t  ON t.asset_id  = a.id
      WHERE  ml.status           = 'published'
        AND  a.organization_id   = ${organizationId}::uuid
        AND  (${assetClass ?? null}::text IS NULL OR a.asset_type::text = ${assetClass ?? null}::text)
        AND  (${currency   ?? null}::text IS NULL OR a.currency         = ${currency   ?? null}::text)
        AND  (${issuerId   ?? null}::text IS NULL OR a.issuer_id::text  = ${issuerId   ?? null}::text)
        AND  (${risk       ?? null}::text IS NULL OR a.metadata->>'risk_level' = ${risk ?? null}::text)
      ORDER  BY ml.published_at DESC
    `
  );
}
