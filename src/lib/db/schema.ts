/**
 * One schema, applied identically by PGlite (local/tests) and Neon (production).
 * Every statement is idempotent so `applySchema` is safe to call on boot.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS care_boards (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL,
  subject_name  TEXT NOT NULL,
  ward_note     TEXT NOT NULL DEFAULT '',
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  caregivers    JSONB NOT NULL DEFAULT '[]'::jsonb,
  share_token   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX IF NOT EXISTS care_boards_owner_idx ON care_boards (owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS care_boards_share_idx ON care_boards (share_token) WHERE share_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS care_entries (
  id             TEXT PRIMARY KEY,
  board_id       TEXT NOT NULL REFERENCES care_boards (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('dose', 'observation', 'note', 'task', 'handover')),
  status         TEXT NOT NULL CHECK (status IN ('due', 'given', 'skipped', 'blocked', 'done')),
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL DEFAULT '',
  medication     TEXT,
  strength       TEXT,
  dose_amount    TEXT,
  route          TEXT,
  instructions   TEXT,
  assigned_to    TEXT,
  recorded_by    TEXT NOT NULL DEFAULT 'anonymous',
  scheduled_for  TEXT,
  occurred_at    TEXT,
  source         TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'importer', 'agent')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS care_entries_board_idx ON care_entries (board_id, scheduled_for);
CREATE INDEX IF NOT EXISTS care_entries_med_idx ON care_entries (board_id, medication);

CREATE TABLE IF NOT EXISTS audit_events (
  id        TEXT PRIMARY KEY,
  board_id  TEXT NOT NULL REFERENCES care_boards (id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  type      TEXT NOT NULL,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,
  entry_id  TEXT,
  payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_seal TEXT NOT NULL,
  seal      TEXT NOT NULL,
  CONSTRAINT audit_events_board_seq_key UNIQUE (board_id, seq)
);

CREATE INDEX IF NOT EXISTS audit_events_board_idx ON audit_events (board_id, seq);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  scope      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result     JSONB
);

CREATE INDEX IF NOT EXISTS idempotency_created_idx ON idempotency_keys (created_at);

CREATE TABLE IF NOT EXISTS session_settings (
  owner_id       TEXT PRIMARY KEY,
  weights        JSONB NOT NULL DEFAULT '{}'::jsonb,
  window_hours   INTEGER NOT NULL DEFAULT 24,
  caregiver_name TEXT,
  updated_at     TEXT NOT NULL
);
`;