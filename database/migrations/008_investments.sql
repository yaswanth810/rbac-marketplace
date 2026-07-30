-- ============================================================
-- Migration 008: Investments
-- ============================================================
-- Run order: 8 of 10
-- Depends on: 001 (investment_status_enum, payment_method_enum)
--             003 (users), 005 (assets)
--
-- No FK to marketplace_listings — an investment references the
-- asset directly. Listings are a view/channel concern only.
-- ============================================================

BEGIN;

CREATE TABLE investments (
  id             UUID                   NOT NULL DEFAULT gen_random_uuid(),
  asset_id       UUID                   NOT NULL,
  investor_id    UUID                   NOT NULL,
  amount         NUMERIC(20, 6)         NOT NULL,
  status         investment_status_enum NOT NULL DEFAULT 'pending',
  payment_method payment_method_enum,
  created_at     TIMESTAMPTZ            NOT NULL DEFAULT now(),

  CONSTRAINT pk_investments              PRIMARY KEY (id),
  CONSTRAINT fk_investments_asset        FOREIGN KEY (asset_id)
                                          REFERENCES assets(id),
  CONSTRAINT fk_investments_investor     FOREIGN KEY (investor_id)
                                          REFERENCES users(id),
  CONSTRAINT chk_investments_amount_pos  CHECK (amount > 0)
);

CREATE INDEX idx_investments_asset_id    ON investments(asset_id);
CREATE INDEX idx_investments_investor_id ON investments(investor_id);
CREATE INDEX idx_investments_status      ON investments(status);
-- Composite for "all investments by an investor, ordered newest first"
CREATE INDEX idx_investments_investor_created
  ON investments(investor_id, created_at DESC);

COMMIT;
