-- ============================================================
-- Migration 011: Convert assets.status from enum to TEXT
-- ============================================================
-- Run order: 11 of 11
-- Depends on: 005 (assets table)
--
-- Replaces the asset_status_enum column type with TEXT and an
-- explicit CHECK constraint. This avoids the ALTER TYPE ADD VALUE
-- transaction-visibility issue in PostgreSQL while adding the three
-- intermediate maker-checker statuses required by the approval workflow.
--
-- Existing data is preserved via USING status::TEXT.
-- The asset_status_enum type itself is left in place so that any
-- views or tooling still referencing it continue to work; it can be
-- dropped in a future cleanup migration once no references remain.
-- ============================================================

BEGIN;

-- Step 1: Re-type the column from asset_status_enum → TEXT.
--         USING clause casts existing enum values to their text labels.
ALTER TABLE assets
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

-- Step 2: Add a CHECK constraint that covers all valid status values,
--         including the three new maker-checker intermediate stages.
ALTER TABLE assets
  ADD CONSTRAINT chk_assets_status CHECK (
    status IN (
      'draft',
      'pending_compliance',
      'pending_legal',
      'pending_admin',
      'approved',
      'rejected',
      'tokenized',
      'listed'
    )
  );

COMMIT;
