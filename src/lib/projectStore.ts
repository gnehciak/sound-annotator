// Project persistence over the /api layer (Neon Postgres behind Vercel
// Functions), scoped per signed-in user. One row per project; notes live
// inline in the `annotations` jsonb (kept small — images go to Blob storage).
import { api, ApiError } from './api'
import { withBlocks } from './noteBlocks'
import { withMigratedOverlay } from './overlays'
import { withMigratedLyrics } from './lyrics'
import type { EditLockClaim } from './editLock'
import type { Annotation, BrowseItem, Project } from '../types'

/**
 * Shape a raw API payload into a Project (shared by both fetchers and the
 * edit-lock poller). The `lock` field is deliberately *not* part of Project —
 * it lives outside React state (see lib/editLock.ts), so heartbeats never
 * mark a project dirty.
 */
export function toProject(id: string, data: Record<string, unknown>): Project {
  // A listing row carries cues in place of notes (api/projects/index.ts):
  // there is nothing in them to migrate, and the migrations must not run on
  // them either — a lyric migration that saw no section lyrics would still be
  // reasoning about notes it hasn't got. Everything else is read as usual.
  const cuesOnly = data.cuesOnly === true
  const notes: Annotation[] = Array.isArray(data.annotations)
    ? cuesOnly
      ? (data.annotations as Partial<Annotation>[]).map((c) => ({
          id: String(c.id),
          start: typeof c.start === 'number' ? c.start : 0,
          ...(typeof c.end === 'number' ? { end: c.end } : {}),
          ...(typeof c.color === 'string' ? { color: c.color } : {}),
          contentHtml: '',
          createdAt: 0,
        }))
      : (data.annotations as Annotation[]).map((a) => withMigratedOverlay(withBlocks(a)))
    : []
  // The per-section lyric blocks that predate timed lines fold into
  // `settings.lyrics` here, for the same read-side-only reason as the
  // per-note migrations below.
  const migrate = cuesOnly ? (p: Project) => p : withMigratedLyrics
  return migrate({
    id,
    // Server-assigned short id for pre-short-id projects; see lib/ids.ts.
    alias: typeof data.alias === 'string' ? data.alias : undefined,
    title: typeof data.title === 'string' ? data.title : 'Untitled track',
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
    source: (data.source ?? undefined) as Project['source'],
    // Migrate legacy notes on read: `contentHtml` only to the block model,
    // and the single anchored pin that predates the score view to the two
    // independent ones. Both are read-side only — a row keeps its old shape
    // until something writes it back.
    annotations: notes,
    ...(cuesOnly ? { cuesOnly: true } : {}),
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    shared: data.shared === true,
    editableByLink: data.editableByLink === true,
    published: data.published === true,
    // Server-stamped on every read; a project the client only ever wrote (a
    // brand-new one) simply has none until its first fetch.
    myRole:
      data.myRole === 'owner' || data.myRole === 'editor' || data.myRole === 'viewer'
        ? data.myRole
        : undefined,
    publishedByName:
      typeof data.publishedByName === 'string' ? data.publishedByName : undefined,
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
    settings:
      data.settings && typeof data.settings === 'object'
        ? (data.settings as Project['settings'])
        : undefined,
    stems:
      data.stems && typeof data.stems === 'object'
        ? (data.stems as Project['stems'])
        : undefined,
    deletedAt: typeof data.deletedAt === 'number' ? data.deletedAt : undefined,
  })
}

/** Load every live project owned by this user, newest first — the trash is a
 *  separate listing (fetchTrashedProjects). (The uid rides in the session
 *  token; the parameter survives for call-site compatibility.)
 *  Every project comes back `cuesOnly` — see that field on Project: the
 *  listing carries the notes' cues, not the notes. Open, copy or export one
 *  through the full row (fetchProject) rather than this. */
export async function fetchProjects(_uid: string): Promise<Project[]> {
  const rows = await api<Record<string, unknown>[]>('/api/projects')
  return rows
    .map((r) => toProject(String(r.id), r))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** Load this user's trash, most recently deleted first — the order a mis-click
 *  wants to be found in. Each project carries its `deletedAt` stamp, which is
 *  what the home page counts the 30 days down from. */
export async function fetchTrashedProjects(): Promise<Project[]> {
  const rows = await api<Record<string, unknown>[]>('/api/projects?trash=1')
  return rows
    .map((r) => toProject(String(r.id), r))
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
}

/**
 * The full row of one project — notes and all — for the caller the API
 * already lets read it (owner, invitee, link holder, admin). This is how a
 * `cuesOnly` listing row becomes a project that can be opened. Throws on a
 * missing or forbidden row, unlike fetchSharedProject, since a track the
 * library just listed has no business being absent.
 */
export async function fetchProject(id: string): Promise<Project> {
  const data = await api<Record<string, unknown>>(
    `/api/projects/${encodeURIComponent(id)}`,
  )
  return toProject(id, data)
}

/**
 * Load a single project by id for the share viewer / an editable link. No
 * auth required — the API only returns the doc if it's `shared` (or
 * `editableByLink`). Returns null when the project is missing or not shared.
 */
export async function fetchSharedProject(id: string): Promise<Project | null> {
  try {
    const data = await api<Record<string, unknown>>(
      `/api/projects/${encodeURIComponent(id)}`,
    )
    return toProject(id, data)
  } catch {
    // 403 (not shared) / 404 (missing) — treat both as "missing".
    return null
  }
}

/**
 * Create or update a single project row.
 *
 * The API merges only the fields this payload carries, so the row's `lock`
 * column — maintained out-of-band by the edit lock — survives every save.
 * When `lock` (a claim) is passed, the save also stamps a fresh server-side
 * heartbeat for that session: the API refuses content writes that don't carry
 * the holder's claim, which is what stops a stale tab from clobbering the
 * current editor (see lib/editLock.ts).
 *
 * `ownerId` is preserved on foreign projects (editable links): the API
 * rejects any write that would reassign it.
 */
export async function saveProject(
  uid: string,
  p: Project,
  lock?: EditLockClaim,
): Promise<void> {
  const payload: Record<string, unknown> = {
    ownerId: p.ownerId ?? uid,
    title: p.title,
    source: p.source,
    updatedAt: p.updatedAt,
    shared: p.shared === true,
    editableByLink: p.editableByLink === true,
    published: p.published === true,
    folderId: p.folderId ?? null,
    settings: p.settings,
  }
  // A listing row holds cues where the notes should be. The API merges only
  // the keys a payload carries, so leaving `annotations` out is what lets a
  // rename or a move from a tile save without wiping the notes it never had.
  if (!p.cuesOnly) payload.annotations = p.annotations
  if (lock) payload.lock = lock
  await api(`/api/projects/${encodeURIComponent(p.id)}`, {
    method: 'PUT',
    json: payload,
  })
}

/**
 * Move a project to the trash. The row survives whole — notes, images, share
 * links — and either comes back through restoreProjectDoc or is deleted for
 * good 30 days on by the purge cron. Nothing of the project's is torn down
 * here; that's purgeProjectDoc's job.
 *
 * The one exception is the admin page deleting a guest project, which goes
 * through this same route and *is* immediate and final — a guest has no trash
 * to restore from (see api/projects/[id]/index.ts).
 */
export async function deleteProjectDoc(id: string): Promise<void> {
  await api(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** Put a trashed project back in the library, exactly as it left. */
export async function restoreProjectDoc(id: string): Promise<void> {
  await api(`/api/projects/${encodeURIComponent(id)}?restore=1`, {
    method: 'POST',
  })
}

/**
 * Delete a project for good — the app's one hard delete, which is why it says
 * so out loud rather than leaving the API to infer it from the caller. Blobs
 * are torn down alongside by the caller (App's purgeProject, AdminProjects'
 * remove).
 *
 * An owner can only purge out of their own trash, so this can't take a live
 * track. A teacher-admin can purge any project outright — the console's
 * permanent delete.
 */
export async function purgeProjectDoc(id: string): Promise<void> {
  await api(`/api/projects/${encodeURIComponent(id)}?purge=1`, {
    method: 'DELETE',
  })
}

/** The public Browse gallery: every published project, newest first. No auth
 *  required — publishing is an explicit opt-in to public listing. */
export async function fetchBrowse(): Promise<BrowseItem[]> {
  return api<BrowseItem[]>('/api/browse')
}

export { ApiError }
