-- ============================================================
-- Migration 012: Convert investments.status from enum to TEXT
-- ============================================================
-- Run order: 12 of 12
-- Depends on: 008 (investments table)
--
-- Adds 'paid' as a real intermediate status between 'pending' and
-- 'confirmed'. This models the two-phase investment approval flow:
--
--   pending → paid (payment captured / mocked; committed before on-chain ops)
--           → confirmed (on-chain mint succeeded)
--
-- A failed mint leaves the investment at 'paid' — payment is captured
-- but token allocation is still pending, giving ops a clear recovery path.
--
-- Uses the same TEXT + CHECK pattern as migration 011 (assets.status)
-- to avoid the ALTER TYPE ADD VALUE transaction-visibility issue.
-- The investment_status_enum type is left in place for any tooling
-- that still references it.
-- ============================================================

BEGIN;

ALTER TABLE investments
  ALTER COLUMN status TYPE TEXT USING status::TEXT;

ALTER TABLE investments
  ADD CONSTRAINT chk_investments_status CHECK (
    status IN (
      'pending',
      'paid',
      'confirmed',
      'settled',
      'cancelled'
    )
  );

COMMIT;
