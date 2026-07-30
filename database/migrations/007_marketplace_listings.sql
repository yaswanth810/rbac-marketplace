-- ============================================================
-- Migration 007: Marketplace Listings
-- ============================================================
-- Run order: 7 of 10
-- Depends on: 001 (listing_status_enum), 005 (assets)
--
-- One listing per asset (UNIQUE on asset_id).
-- published_at is set when status transitions to 'published'.
-- ============================================================

BEGIN;

CREATE TABLE marketplace_listings (
  id           UUID                NOT NULL DEFAULT gen_random_uuid(),
  asset_id     UUID                NOT NULL,
  status       listing_status_enum NOT NULL DEFAULT 'draft',
  published_at TIMESTAMPTZ,                 -- NULL until first publish action

  CONSTRAINT pk_marketplace_listings          PRIMARY KEY (id),
  CONSTRAINT uq_marketplace_listings_asset_id UNIQUE (asset_id),
  CONSTRAINT fk_marketplace_listings_asset    FOREIGN KEY (asset_id)
                                               REFERENCES assets(id)
                                               ON DELETE CASCADE
);

CREATE INDEX idx_marketplace_listings_asset_id ON marketplace_listings(asset_id);
CREATE INDEX idx_marketplace_listings_status   ON marketplace_listings(status);
-- For filtering published listings efficiently
CREATE INDEX idx_marketplace_listings_published
  ON marketplace_listings(published_at DESC)
  WHERE status = 'published';

COMMIT;
