-- Firmware Portal database schema
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'viewer')),
  permissions   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Safe to re-run: adds the column for databases created before this feature existed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '{}'::jsonb;
-- `permissions` keys used by the app (all booleans, all default to absent/false):
--   early_access : can view/download firmware files before full approval
--   stage_1      : can update the "Firmware Team" approval stage
--   stage_2      : can update the "QC Team" approval stage
--   stage_3      : can update the "Kitchen Team" approval stage
--   stage_4      : can update the "Sandy Sir" approval stage
-- Admins implicitly have all of the above regardless of this column.
CREATE TABLE IF NOT EXISTS projects (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  type            TEXT NOT NULL DEFAULT 'firmware' CHECK (type IN ('firmware', 'app')),
  drive_folder_id TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Safe to re-run: adds the column for databases created before this feature existed.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'firmware' CHECK (type IN ('firmware', 'app'));
-- `type` determines which files a release under this project accepts:
--   firmware : .bin (required), Firmware .zip (optional), Holtek .zip (optional)
--   app      : .zip (required), .apk (required)
CREATE TABLE IF NOT EXISTS releases (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         TEXT NOT NULL,
  note            TEXT,
  bin_file_id     TEXT,
  bin_file_name   TEXT,
  zip_file_id     TEXT,
  zip_file_name   TEXT,
  zip2_file_id    TEXT,
  zip2_file_name  TEXT,
  apk_file_id     TEXT,
  apk_file_name   TEXT,
  overall_status  TEXT NOT NULL DEFAULT 'pending' CHECK (overall_status IN ('pending', 'approved', 'rejected')),
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project_id, version)
);
-- Safe to re-run: adds columns for databases created before these features existed.
ALTER TABLE releases ADD COLUMN IF NOT EXISTS zip2_file_id TEXT;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS zip2_file_name TEXT;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS apk_file_id TEXT;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS apk_file_name TEXT;
ALTER TABLE releases ALTER COLUMN zip_file_id DROP NOT NULL;
ALTER TABLE releases ALTER COLUMN zip_file_name DROP NOT NULL;
CREATE TABLE IF NOT EXISTS release_stages (
  id          SERIAL PRIMARY KEY,
  release_id  INTEGER NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  stage_number INTEGER NOT NULL CHECK (stage_number BETWEEN 1 AND 4),
  stage_name  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed')),
  remarks     TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ,
  UNIQUE(release_id, stage_number)
);
CREATE TABLE IF NOT EXISTS tickets (
  id           SERIAL PRIMARY KEY,
  ticket_code  TEXT NOT NULL UNIQUE,
  designation  TEXT NOT NULL,
  name         TEXT NOT NULL,
  note         TEXT NOT NULL,
  urgency      TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high', 'urgent')),
  deadline     DATE,
  project_id   INTEGER REFERENCES projects(id),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'rejected')),
  admin_notes  TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_releases_project ON releases(project_id);
CREATE INDEX IF NOT EXISTS idx_stages_release ON release_stages(release_id);
CREATE INDEX IF NOT EXISTS idx_tickets_code ON tickets(ticket_code);
