-- ============================================================
-- Firmware Portal Database Schema
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  permissions   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe migration for existing databases
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Permission keys:
--   early_access : can view/download firmware files before full approval
--   stage_1      : can update Firmware Team stage
--   stage_2      : can update QC Team stage
--   stage_3      : can update Kitchen Team stage
--   stage_4      : can update Sandy Sir stage
--
-- Admins implicitly have all permissions.


-- ============================================================
-- PROJECTS
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'firmware'
                    CHECK (type IN ('firmware', 'app')),
  drive_folder_id TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe migration for existing databases
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'firmware';

-- Ensure existing/new values comply with the intended types.
-- Existing installations should already contain valid values.
-- type:
--   firmware : .bin required, Firmware .zip optional,
--              Holtek .zip optional
--   app      : .apk required, App .zip required


-- ============================================================
-- RELEASES
-- ============================================================

CREATE TABLE IF NOT EXISTS releases (
  id              SERIAL PRIMARY KEY,

  project_id      INTEGER NOT NULL
                    REFERENCES projects(id)
                    ON DELETE CASCADE,

  version         TEXT NOT NULL,
  note            TEXT,

  -- Date selected on the release upload form
  release_date    DATE,

  -- Set automatically when all four approval stages pass
  approved_at     TIMESTAMPTZ,

  -- Firmware files
  bin_file_id     TEXT,
  bin_file_name   TEXT,

  -- Main ZIP
  zip_file_id     TEXT,
  zip_file_name   TEXT,

  -- Optional second ZIP (Holtek)
  zip2_file_id    TEXT,
  zip2_file_name  TEXT,

  -- Android application
  apk_file_id     TEXT,
  apk_file_name   TEXT,

  overall_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (
                      overall_status IN (
                        'pending',
                        'approved',
                        'rejected'
                      )
                    ),

  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(project_id, version)
);


-- ============================================================
-- RELEASE MIGRATIONS
-- ============================================================

-- Existing databases may not have these columns.

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS release_date DATE;

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS zip2_file_id TEXT;

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS zip2_file_name TEXT;

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS apk_file_id TEXT;

ALTER TABLE releases
  ADD COLUMN IF NOT EXISTS apk_file_name TEXT;


-- ZIP is optional for app releases / newer release types
ALTER TABLE releases
  ALTER COLUMN zip_file_id DROP NOT NULL;

ALTER TABLE releases
  ALTER COLUMN zip_file_name DROP NOT NULL;


-- ============================================================
-- LEGACY EXE → APK MIGRATION
-- ============================================================
--
-- Older production versions used:
--
--   exe_file_id
--   exe_file_name
--
-- The Android application is now correctly represented as:
--
--   apk_file_id
--   apk_file_name
--
-- If the old columns exist, migrate their data into the new
-- APK columns without overwriting already-migrated APK data.
--

DO $$
BEGIN

  -- If the old exe_file_id column exists, copy it to apk_file_id.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'releases'
      AND column_name = 'exe_file_id'
  ) THEN

    UPDATE releases
    SET apk_file_id = exe_file_id
    WHERE apk_file_id IS NULL
      AND exe_file_id IS NOT NULL;

  END IF;


  -- If the old exe_file_name column exists, copy it to apk_file_name.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'releases'
      AND column_name = 'exe_file_name'
  ) THEN

    UPDATE releases
    SET apk_file_name = exe_file_name
    WHERE apk_file_name IS NULL
      AND exe_file_name IS NOT NULL;

  END IF;

END $$;


-- ============================================================
-- RELEASE STAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS release_stages (
  id            SERIAL PRIMARY KEY,

  release_id    INTEGER NOT NULL
                  REFERENCES releases(id)
                  ON DELETE CASCADE,

  stage_number  INTEGER NOT NULL
                  CHECK (stage_number BETWEEN 1 AND 4),

  stage_name    TEXT NOT NULL,

  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (
                    status IN (
                      'pending',
                      'passed',
                      'failed'
                    )
                  ),

  remarks       TEXT,

  updated_by    INTEGER REFERENCES users(id),

  updated_at    TIMESTAMPTZ,

  UNIQUE(release_id, stage_number)
);


-- ============================================================
-- TICKETS
-- ============================================================

CREATE TABLE IF NOT EXISTS tickets (
  id           SERIAL PRIMARY KEY,

  ticket_code  TEXT NOT NULL UNIQUE,

  designation  TEXT NOT NULL,

  name         TEXT NOT NULL,

  note         TEXT NOT NULL,

  urgency      TEXT NOT NULL DEFAULT 'medium'
                 CHECK (
                   urgency IN (
                     'low',
                     'medium',
                     'high',
                     'urgent'
                   )
                 ),

  deadline     DATE,

  project_id   INTEGER REFERENCES projects(id),

  status       TEXT NOT NULL DEFAULT 'open'
                 CHECK (
                   status IN (
                     'open',
                     'in_progress',
                     'resolved',
                     'rejected'
                   )
                 ),

  admin_notes  TEXT,

  created_by   INTEGER REFERENCES users(id),

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_releases_project
  ON releases(project_id);

CREATE INDEX IF NOT EXISTS idx_stages_release
  ON release_stages(release_id);

CREATE INDEX IF NOT EXISTS idx_tickets_code
  ON tickets(ticket_code);