// Neon client + row shaping shared by the /api functions. Column names are
// snake_case in Postgres, camelCase over the wire (matching src/types.ts).
import { neon } from '@neondatabase/serverless'

export const sql = neon(process.env.DATABASE_URL as string)

/** The edit lock as stored in the `lock` jsonb column. `at` is epoch ms and is
 *  only ever stamped server-side (see api/projects/[id]/lock.ts). */
export interface LockValue {
  sessionId: string
  uid: string
  name: string
  at: number
}

export interface ProjectRow {
  id: string
  owner_id: string
  title: string
  source: unknown
  annotations: unknown
  updated_at: string | number // bigint arrives as a string
  shared: boolean
  editable_by_link: boolean
  folder_id: string | null
  settings: unknown
  lock: LockValue | null
  published: boolean
  published_at: string | number | null
  published_by_name: string | null
  /** AI section-detection job state + cached result (api/projects/[id]/analyze.ts). */
  analysis: unknown
}

export interface FolderRow {
  id: string
  owner_id: string
  name: string
  created_at: string | number
}

// A lock is live while its heartbeat is fresher than 40s; clients treat theirs
// as stale at 45s (LOCK_TTL_MS in src/lib/editLock.ts), so a claim the client
// still defends is never one the server has already released.
export const LOCK_LIVE_MS = 40_000

export function lockLive(lock: LockValue | null | undefined): boolean {
  return (
    lock != null &&
    typeof lock.at === 'number' &&
    Date.now() - lock.at < LOCK_LIVE_MS
  )
}

export function rowToProject(
  r: ProjectRow,
  opts?: { withLock?: boolean },
): Record<string, unknown> {
  const p: Record<string, unknown> = {
    id: r.id,
    ownerId: r.owner_id,
    title: r.title,
    source: r.source ?? undefined,
    annotations: r.annotations ?? [],
    updatedAt: Number(r.updated_at) || 0,
    shared: r.shared === true,
    editableByLink: r.editable_by_link === true,
    folderId: r.folder_id,
    settings: r.settings ?? undefined,
    published: r.published === true,
    publishedByName: r.published_by_name ?? undefined,
  }
  // Saved stem URLs surface as a read-only field (PUT never accepts them —
  // the analyze endpoint is their only writer).
  const stems = (r.analysis as { stems?: Record<string, string> } | null)?.stems
  if (stems && Object.keys(stems).length > 0) p.stems = stems
  if (opts?.withLock) p.lock = r.lock ?? null
  return p
}

export function rowToFolder(r: FolderRow): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    createdAt: Number(r.created_at) || 0,
  }
}

export async function getProjectRow(id: string): Promise<ProjectRow | null> {
  const rows = (await sql`SELECT * FROM projects WHERE id = ${id}`) as ProjectRow[]
  return rows[0] ?? null
}

/** Serialize a value for a jsonb column (NULL when absent). */
export function jsonb(v: unknown): string | null {
  return v === undefined || v === null ? null : JSON.stringify(v)
}
