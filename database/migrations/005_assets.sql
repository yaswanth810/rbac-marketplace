-- ============================================================
-- Migration 005: Assets & Asset Approvals
-- ============================================================
-- Run order: 5 of 10
-- Depends on: 001 (enums), 002 (organizations), 003 (users)
--
-- assets.metadata JSONB folds KYC/AML/payment data per spec.
-- GIN index on metadata enables efficient jsonb operators.
-- ============================================================

BEGIN;

-- ── Assets ────────────────────────────────────────────────────
CREATE TABLE assets (
  id              UUID              NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID              NOT NULL,
  name            TEXT              NOT NULL,
  asset_type      asset_type_enum   NOT NULL,
  description     TEXT,
  status          asset_status_enum NOT NULL DEFAULT 'draft',
  issuer_id       UUID              NOT NULL,
  jurisdiction    TEXT,
  currency        CHAR(3),                       -- ISO 4217, e.g. 'USD'
  total_value     NUMERIC(20, 6),
  metadata        JSONB             NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),

  CONSTRAINT pk_assets               PRIMARY KEY (id),
  CONSTRAINT fk_assets_org           FOREIGN KEY (organization_id)
                                      REFERENCES organizations(id)
                                      ON DELETE CASCADE,
  CONSTRAINT fk_assets_issuer        FOREIGN KEY (issuer_id)
                                      REFERENCES users(id)
);

CREATE INDEX idx_assets_organization_id ON assets(organization_id);
CREATE INDEX idx_assets_issuer_id       ON assets(issuer_id);
CREATE INDEX idx_assets_status          ON assets(status);
CREATE INDEX idx_assets_asset_type      ON assets(asset_type);
-- GIN index allows efficient @>, ?, ?& operators on metadata
CREATE INDEX idx_assets_metadata        ON assets USING gin(metadata);

-- ── Asset Approvals ───────────────────────────────────────────
-- One row per review stage per asset. Approval stages are defined
-- in the approval_stage_roles table (migration 010).
CREATE TABLE asset_approvals (
  id          UUID                   NOT NULL DEFAULT gen_random_uuid(),
  asset_id    UUID                   NOT NULL,
  stage       TEXT                   NOT NULL,  -- e.g. 'pending_compliance'
  approver_id UUID                   NOT NULL,
  decision    approval_decision_enum NOT NULL DEFAULT 'pending',
  comment     TEXT,
  created_at  TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT pk_asset_approvals           PRIMARY KEY (id),
  CONSTRAINT fk_asset_approvals_asset     FOREIGN KEY (asset_id)
                                           REFERENCES assets(id)
                                           ON DELETE CASCADE,
  CONSTRAINT fk_asset_approvals_approver  FOREIGN KEY (approver_id)
                                           REFERENCES users(id)
);

CREATE INDEX idx_asset_approvals_asset_id    ON asset_approvals(asset_id);
CREATE INDEX idx_asset_approvals_approver_id ON asset_approvals(approver_id);
CREATE INDEX idx_asset_approvals_stage       ON asset_approvals(stage);
-- Composite: quickly find the current decision for a given asset+stage
CREATE INDEX idx_asset_approvals_asset_stage ON asset_approvals(asset_id, stage);

COMMIT;
