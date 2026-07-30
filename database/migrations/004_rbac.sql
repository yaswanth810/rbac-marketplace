-- ============================================================
-- Migration 004: RBAC Tables
-- ============================================================
-- Run order: 4 of 10
-- Depends on: 002 (organizations), 003 (users)
--
-- IMPORTANT — NULL uniqueness for roles:
--   organization_id IS NULL  → platform-level system role
--   organization_id IS NOT NULL → org-scoped custom role
--
--   PostgreSQL UNIQUE constraints treat NULLs as distinct,
--   so a table-level UNIQUE(organization_id, name) would allow
--   duplicate system role names. We use two partial unique
--   indexes instead to handle each case correctly.
-- ============================================================

BEGIN;

-- ── Roles ─────────────────────────────────────────────────────
CREATE TABLE roles (
  id              UUID    NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID,                    -- NULL = platform system role
  name            TEXT    NOT NULL,
  is_system_role  BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT pk_roles        PRIMARY KEY (id),
  CONSTRAINT fk_roles_org    FOREIGN KEY (organization_id)
                              REFERENCES organizations(id)
                              ON DELETE CASCADE
);

-- Enforce unique role names within each scope separately
-- (table-level UNIQUE cannot handle the NULL case correctly)
CREATE UNIQUE INDEX idx_roles_unique_system_name
  ON roles(name)
  WHERE organization_id IS NULL;

CREATE UNIQUE INDEX idx_roles_unique_org_name
  ON roles(organization_id, name)
  WHERE organization_id IS NOT NULL;

CREATE INDEX idx_roles_organization_id ON roles(organization_id);

-- ── Permissions ───────────────────────────────────────────────
CREATE TABLE permissions (
  id  UUID NOT NULL DEFAULT gen_random_uuid(),
  key TEXT NOT NULL,

  CONSTRAINT pk_permissions    PRIMARY KEY (id),
  CONSTRAINT uq_permissions_key UNIQUE (key)
);

-- ── Role ↔ Permission join ────────────────────────────────────
CREATE TABLE role_permissions (
  role_id       UUID NOT NULL,
  permission_id UUID NOT NULL,

  CONSTRAINT pk_role_permissions         PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role    FOREIGN KEY (role_id)
                                          REFERENCES roles(id)
                                          ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_perm    FOREIGN KEY (permission_id)
                                          REFERENCES permissions(id)
                                          ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_role_id       ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON role_permissions(permission_id);

-- ── User ↔ Role join ──────────────────────────────────────────
CREATE TABLE user_roles (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,

  CONSTRAINT pk_user_roles          PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user     FOREIGN KEY (user_id)
                                     REFERENCES users(id)
                                     ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role     FOREIGN KEY (role_id)
                                     REFERENCES roles(id)
                                     ON DELETE CASCADE
);

CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);

COMMIT;
