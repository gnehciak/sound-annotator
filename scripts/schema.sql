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

-- Publishing (the public Browse gallery). Kept as ALTERs so re-running this
-- file upgrades an existing database in place.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published_at bigint;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS published_by_name text;

CREATE INDEX IF NOT EXISTS projects_published_idx ON projects (published_at DESC) WHERE published;

-- AI section detection (api/projects/[id]/analyze.ts). Job state + the cached
-- result of the Replicate music-structure run, e.g.
-- { status: 'running'|'done'|'error', predictionId, sections: [{start,end,label}],
--   bpm, startedAt, finishedAt, error }.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS analysis jsonb;

CREATE TABLE IF NOT EXISTS folders (
  id         text PRIMARY KEY,
  owner_id   text NOT NULL,
  name       text NOT NULL DEFAULT 'Untitled folder',
  created_at bigint NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS folders_owner_idx ON folders (owner_id);
