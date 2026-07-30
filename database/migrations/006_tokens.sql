-- ============================================================
-- Migration 006: Tokens
-- ============================================================
-- Run order: 6 of 10
-- Depends on: 005 (assets)
--
-- One token record per asset (UNIQUE on asset_id).
-- contract_address is nullable until the contract is deployed
-- via Treasury Officer's token.deploy action.
-- ============================================================

BEGIN;

CREATE TABLE tokens (
  id               UUID          NOT NULL DEFAULT gen_random_uuid(),
  asset_id         UUID          NOT NULL,
  contract_address TEXT,                    -- NULL until deployed on-chain
  token_symbol     TEXT          NOT NULL,
  total_supply     NUMERIC(30, 0),          -- large enough for 18-decimal tokens
  decimals         SMALLINT      NOT NULL DEFAULT 18,
  price            NUMERIC(20, 6),          -- unit price in asset currency
  chain_id         INTEGER       NOT NULL,  -- EIP-155 chain ID (31337=localhost, 11155111=Sepolia)

  CONSTRAINT pk_tokens            PRIMARY KEY (id),
  CONSTRAINT uq_tokens_asset_id   UNIQUE (asset_id),  -- one token config per asset
  CONSTRAINT fk_tokens_asset      FOREIGN KEY (asset_id)
                                   REFERENCES assets(id)
                                   ON DELETE CASCADE,
  CONSTRAINT chk_tokens_decimals  CHECK (decimals BETWEEN 0 AND 18)
);

CREATE INDEX idx_tokens_asset_id         ON tokens(asset_id);
CREATE INDEX idx_tokens_contract_address ON tokens(contract_address);
CREATE INDEX idx_tokens_chain_id         ON tokens(chain_id);

COMMIT;
