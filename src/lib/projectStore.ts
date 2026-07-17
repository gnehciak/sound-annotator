// Project persistence over the /api layer (Neon Postgres behind Vercel
// Functions), scoped per signed-in user. One row per project; notes live
// inline in the `annotations` jsonb (kept small — images go to Blob storage).
import { api, ApiError } from './api'
import { withBlocks } from './noteBlocks'
import type { EditLockClaim } from './editLock'
import type { Annotation, BrowseItem, Project } from '../types'

/**
 * Shape a raw API payload into a Project (shared by both fetchers and the
 * edit-lock poller). The `lock` field is deliberately *not* part of Project —
 * it lives outside React state (see lib/editLock.ts), so heartbeats never
 * mark a project dirty.
 */
export function toProject(id: string, data: Record<string, unknown>): Project {
  return {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled track',
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
    source: (data.source ?? undefined) as Project['source'],
    // Migrate legacy notes (contentHtml only) to the block model on read.
    annotations: Array.isArray(data.annotations)
      ? (data.annotations as Annotation[]).map(withBlocks)
      : [],
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    shared: data.shared === true,
    editableByLink: data.editableByLink === true,
    published: data.published === true,
    publishedByName:
      typeof data.publishedByName === 'string' ? data.publishedByName : undefined,
    folderId: typeof data.folderId === 'string' ? data.folderId : null,
    settings:
      data.settings && typeof data.settings === 'object'
        ? (data.settings as Project['settings'])
        : undefined,
    deletedAt: typeof data.deletedAt === 'number' ? data.deletedAt : undefined,
  }
}

/** Load every live project owned by this user, newest first — the trash is a
 *  separate listing (fetchTrashedProjects). (The uid rides in the session
 *  token; the parameter survives for call-site compatibility.) */
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
    annotations: p.annotations,
    updatedAt: p.updatedAt,
    shared: p.shared === true,
    editableByLink: p.editableByLink === true,
    published: p.published === true,
    folderId: p.folderId ?? null,
    settings: p.settings,
  }
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
  await api(`/api/projects/${encodeURIComponent(id)}/trash`, { method: 'POST' })
}

/** Delete a trashed project for good. The API only purges from the trash, so
 *  this can never take a live track; its blobs are torn down alongside by the
 *  caller (App's purgeProject). */
export async function purgeProjectDoc(id: string): Promise<void> {
  await api(`/api/projects/${encodeURIComponent(id)}/trash`, { method: 'DELETE' })
}

/** The public Browse gallery: every published project, newest first. No auth
 *  required — publishing is an explicit opt-in to public listing. */
export async function fetchBrowse(): Promise<BrowseItem[]> {
  return api<BrowseItem[]>('/api/browse')
}

export { ApiError }
