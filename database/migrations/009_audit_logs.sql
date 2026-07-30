-- ============================================================
-- Migration 009: Audit Logs
-- ============================================================
-- Run order: 9 of 10
-- Depends on: 002 (organizations), 003 (users)
--
-- Designed for append-only, high-volume writes:
-- - No ON DELETE CASCADE — logs must survive user/org deletion.
--   FKs use ON DELETE SET NULL so the row is retained.
-- - created_at index is DESC for efficient "latest logs first"
--   queries without a full table scan.
-- - Partial index on resource_type for targeted queries.
-- ============================================================

BEGIN;

CREATE TABLE audit_logs (
  id              UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id         UUID,                    -- NULL = system-initiated action
  action          TEXT        NOT NULL,    -- e.g. 'asset.approve', 'user.delete'
  resource_type   TEXT        NOT NULL,    -- e.g. 'asset', 'user', 'role'
  resource_id     UUID,                    -- the affected record's ID
  organization_id UUID,                    -- for org-scoped filtering
  previous_state  JSONB,                   -- snapshot before change
  new_state       JSONB,                   -- snapshot after change
  ip_address      INET,                    -- client IP (nullable for internal actions)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_audit_logs       PRIMARY KEY (id),
  -- SET NULL on delete so audit history is retained even if the user is removed
  CONSTRAINT fk_audit_logs_user  FOREIGN KEY (user_id)
                                  REFERENCES users(id)
                                  ON DELETE SET NULL,
  CONSTRAINT fk_audit_logs_org   FOREIGN KEY (organization_id)
                                  REFERENCES organizations(id)
                                  ON DELETE SET NULL
);

-- Core query patterns
CREATE INDEX idx_audit_logs_user_id         ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_organization_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_resource_type   ON audit_logs(resource_type);
CREATE INDEX idx_audit_logs_resource_id     ON audit_logs(resource_id);
CREATE INDEX idx_audit_logs_action          ON audit_logs(action);
-- Newest-first pagination (the most common fetch pattern for audit feeds)
CREATE INDEX idx_audit_logs_created_at      ON audit_logs(created_at DESC);
-- Org-scoped audit feed: organization + time range
CREATE INDEX idx_audit_logs_org_created
  ON audit_logs(organization_id, created_at DESC);

COMMIT;
