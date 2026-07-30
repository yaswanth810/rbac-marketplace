-- ============================================================
-- Migration 001: Extensions & Enum Types
-- ============================================================
-- Run order: 1 of 10
-- All enum types used across the schema are created here so
-- subsequent migrations can reference them safely.
-- ============================================================

BEGIN;

-- UUID generation support
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── User / Identity ──────────────────────────────────────────
CREATE TYPE kyc_status_enum AS ENUM (
  'pending',
  'submitted',
  'approved',
  'rejected'
);

CREATE TYPE user_status_enum AS ENUM (
  'active',
  'inactive',
  'suspended'
);

-- ── Assets ───────────────────────────────────────────────────
CREATE TYPE asset_type_enum AS ENUM (
  'real_estate',
  'equity',
  'bond',
  'commodity',
  'fund',
  'other'
);

CREATE TYPE asset_status_enum AS ENUM (
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'tokenized',
  'listed'
);

-- ── Approvals ────────────────────────────────────────────────
CREATE TYPE approval_decision_enum AS ENUM (
  'pending',
  'approved',
  'rejected'
);

-- ── Marketplace ───────────────────────────────────────────────
CREATE TYPE listing_status_enum AS ENUM (
  'draft',
  'published',
  'unpublished',
  'closed'
);

-- ── Investments ──────────────────────────────────────────────
CREATE TYPE investment_status_enum AS ENUM (
  'pending',
  'confirmed',
  'settled',
  'cancelled'
);

CREATE TYPE payment_method_enum AS ENUM (
  'bank_transfer',
  'crypto',
  'card',
  'stablecoin'
);

COMMIT;
