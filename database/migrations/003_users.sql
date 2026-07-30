-- ============================================================
-- Migration 003: Users
-- ============================================================
-- Run order: 3 of 10
-- Depends on: 001 (enums), 002 (organizations, departments)
-- ============================================================

BEGIN;

CREATE TABLE users (
  id              UUID             NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID             NOT NULL,
  department_id   UUID,                       -- nullable: user may not belong to a dept
  name            TEXT             NOT NULL,
  email           TEXT             NOT NULL,
  password_hash   TEXT             NOT NULL,
  wallet_address  TEXT,                       -- nullable: set after wallet connection
  kyc_status      kyc_status_enum  NOT NULL DEFAULT 'pending',
  status          user_status_enum NOT NULL DEFAULT 'active',
  last_login      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ      NOT NULL DEFAULT now(),

  CONSTRAINT pk_users              PRIMARY KEY (id),
  CONSTRAINT uq_users_email        UNIQUE (email),
  CONSTRAINT uq_users_wallet       UNIQUE (wallet_address),
  CONSTRAINT fk_users_org          FOREIGN KEY (organization_id)
                                    REFERENCES organizations(id)
                                    ON DELETE CASCADE,
  CONSTRAINT fk_users_department   FOREIGN KEY (department_id)
                                    REFERENCES departments(id)
                                    ON DELETE SET NULL
);

-- Indexes
CREATE INDEX idx_users_organization_id ON users(organization_id);
CREATE INDEX idx_users_department_id   ON users(department_id);
CREATE INDEX idx_users_kyc_status      ON users(kyc_status);
CREATE INDEX idx_users_status          ON users(status);
-- email is already covered by the UNIQUE constraint index

COMMIT;
