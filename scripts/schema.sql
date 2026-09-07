-- Neon schema for Sound Annotator. Applied via scripts/apply-schema.mjs.
-- One row per project, notes inline in the `annotations` jsonb; folders are
-- just named rows (membership lives on each project's folder_id).

CREATE TABLE IF NOT EXISTS projects (
  id               text PRIMARY KEY,
  owner_id         text NOT NULL,
  title            text NOT NULL DEFAULT 'Untitled track',
  source           jsonb,
  annotations      jsonb NOT NULL DEFAULT '[]',
  updated_at       bigint NOT NULL DEFAULT 0,
  shared           boolean NOT NULL DEFAULT false,
  editable_by_link boolean NOT NULL DEFAULT false,
  folder_id        text,
  settings         jsonb,
  -- Edit lock: { sessionId, uid, name, at } where `at` is epoch ms stamped by
  -- the API server (never trusted from the client) — see api/_lib/lock.ts.
  lock             jsonb
);

CREATE INDEX IF NOT EXISTS projects_owner_idx ON projects (owner_id);

-- Short public id (src/lib/ids.ts). The primary key stays whatever it was —
-- for the 80 projects that predate short ids that's a 36-character uuid, which
-- is also baked into their Blob paths (users/{owner}/images/{id}/...) and into
-- every link already handed to a class. So the short id rides alongside as an
-- alias rather than replacing the key: links are built from `alias ?? id`, and
-- lookups accept either, which keeps old links resolving and leaves 898 MB of
-- blobs exactly where the teardown sweeps expect to find them.
-- Backfill with scripts/backfill-aliases.mjs.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS alias text;
CREATE UNIQUE INDEX IF NOT EXISTS projects_alias_idx ON projects (alias);

-- Publishing (the public Browse gallery). Kept as ALTERs so re-running this
-- file upgrades an existing database in place.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published_at bigint;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published_by_name text;

CREATE INDEX IF NOT EXISTS projects_published_idx ON projects (published_at DESC) WHERE published;

-- AI section detection (api/projects/[id]/analyze.ts). Job state + the cached
-- result of the Replicate music-structure run, e.g.
-- { status: 'running'|'done'|'error', predictionId, sections: [{start,end,label}],
--   stems, bpm, startedAt, finishedAt, error }.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS analysis jsonb;

-- Trash (soft delete). NULL on a live project; the epoch ms of the move to the
-- trash otherwise. A trashed row stays whole — notes, images, share flags — so
-- Restore puts the track back exactly as it left; api/cron/purge-trash.ts
-- hard-deletes it (and its blobs) 30 days later. Nothing else writes this
-- column: see api/projects/[id]/trash.ts.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at bigint;

-- The daily purge scan's index. Partial, so it stays tiny — the trash is a
-- handful of rows next to a whole table of live ones.
CREATE INDEX IF NOT EXISTS projects_trash_idx ON projects (deleted_at) WHERE deleted_at IS NOT NULL;

-- Guest projects (students who never sign in). owner_id holds a synthetic
-- `guest:<uuid>`; this column holds the SHA-256 of the key that rides in the
-- student's URL — never the key itself. NULL on every signed-in project.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS guest_token_hash text;

-- Rate limit for signed-out project creation (there is no account to attach a
-- limit to). Keyed by a HASH of the caller's IP: a limiter needs to recognise
-- a repeat caller, not to know who they are, and these are schoolchildren.
CREATE TABLE IF NOT EXISTS guest_quota (
  ip_hash      text PRIMARY KEY,
  window_start bigint NOT NULL,
  count        int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS folders (
  id         text PRIMARY KEY,
  owner_id   text NOT NULL,
  name       text NOT NULL DEFAULT 'Untitled folder',
  created_at bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS folders_owner_idx ON folders (owner_id);
