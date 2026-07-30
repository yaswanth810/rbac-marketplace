-- ============================================================
-- Migration 010: Approval Stage → Role Mapping
-- ============================================================
-- Run order: 10 of 10
-- Depends on: nothing (self-contained reference table)
--
-- This table is the source of truth for which role is required
-- to act on each approval stage. The approval endpoint reads
-- this table to guard against an unauthorised role submitting
-- a decision, even if they hold asset.approve permission.
--
-- role_name is a soft reference to roles.name (no FK) to avoid
-- coupling migration order to seed data. The seed script inserts
-- matching role names into the roles table.
-- ============================================================

BEGIN;

CREATE TABLE approval_stage_roles (
  stage     TEXT NOT NULL,   -- matches asset_approvals.stage values
  role_name TEXT NOT NULL,   -- soft ref to roles.name (platform system role)
  label     TEXT NOT NULL,   -- human-readable label for UI / API responses

  CONSTRAINT pk_approval_stage_roles PRIMARY KEY (stage)
);

-- No additional indexes needed — table will have O(10) rows
-- and will always be queried by primary key (stage).

COMMIT;
