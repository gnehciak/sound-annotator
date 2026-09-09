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

-- Accounts. Sound Annotator does its own Google sign-in (api/auth/[action].ts),
-- so this table is the user directory that Clerk used to be — which is also
-- what lets api/admin/users.ts answer from one store instead of stitching two.
--
-- `id` is the whole point of this table's shape. It is NOT a fresh key: for the
-- four accounts that predate first-party auth it is the *Clerk* `user_…` id,
-- seeded verbatim by scripts/migrate-clerk-users.mjs. That id is written into
-- every projects.owner_id, every folders.owner_id, and every Blob path
-- (users/{owner_id}/images/{projectId}/…), so minting new ids at the cutover
-- would have orphaned 31 projects and stranded their images. Sign-in resolves a
-- Google identity back to this id — by `google_sub` first, then by verified
-- email — rather than the other way round. Accounts created since get a short
-- id from api/_lib/ids.ts. Nothing parses either form; ids stay opaque.
CREATE TABLE IF NOT EXISTS users (
  id              text PRIMARY KEY,
  -- Google's stable subject claim. The real join key: an address can change
  -- hands, `sub` cannot. NULL only on a seeded row nobody has signed into yet.
  google_sub      text UNIQUE,
  email           text NOT NULL,
  name            text,
  image_url       text,
  created_at      bigint NOT NULL DEFAULT 0,
  last_sign_in_at bigint
);

-- Email is the fallback match at sign-in and the key ADMIN_EMAILS is checked
-- against, both case-insensitively — so uniqueness has to be too.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_idx ON users (lower(email));

-- Per-person sharing: who, besides the owner, may open a project and with what
-- power. Keyed by EMAIL rather than uid, for the same reason ADMIN_EMAILS is —
-- an invite is written before the person has necessarily signed in (and it
-- survives the dev→production Clerk move, which mints new uids). Emails are
-- stored lowercased; the API lowercases both sides of every comparison.
--
-- Roles: 'viewer' (open read-only, exactly as a view link) and 'editor' (write
-- content, exactly as a link editor — never sharing, ownership or source).
-- Absent row = no access, which is the default for everyone.
--
-- Rows are the project's, not the person's: they die with the project (the
-- purge cron and DELETE ?purge=1 clear them) and ride the trash intact, so a
-- restore puts the invite list back exactly as it left.
CREATE TABLE IF NOT EXISTS project_shares (
  project_id text NOT NULL,
  email      text NOT NULL,
  role       text NOT NULL DEFAULT 'viewer',
  invited_at bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, email)
);

-- The lookup that runs on every foreign read: "what may this email do here?"
CREATE INDEX IF NOT EXISTS project_shares_email_idx ON project_shares (email);
