-- ============================================================
-- Migration 002: Organizations & Departments
-- ============================================================
-- Run order: 2 of 10
-- ============================================================

BEGIN;

CREATE TABLE organizations (
  id         UUID        NOT NULL DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_organizations PRIMARY KEY (id)
);

CREATE TABLE departments (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  name            TEXT NOT NULL,

  CONSTRAINT pk_departments              PRIMARY KEY (id),
  CONSTRAINT fk_departments_org         FOREIGN KEY (organization_id)
                                         REFERENCES organizations(id)
                                         ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_departments_organization_id ON departments(organization_id);

COMMIT;
