// The separated stems, as a per-video shared store — the source of truth,
// independent of any user or project. A detect run writes the stems under
// `cache/stems/<mediaKey>/`, keyed by the recording (a YouTube video id, a
// Drive file id), the same shape the downloaded-video and clip-audio caches
// already use (mediaCache.ts). Every project of that recording then reads the
// same stems, so a student's board reuses a teacher's with no second paid run,
// and nothing has to be re-hosted when a board is copied.
//
// Audio-URL tracks have no stable key, so their stems stay under the owner's
// own prefix (users/{uid}/stems/{projectId}/) — the legacy location, which is
// also where every stem produced before this lived. resolveStems reads the
// shared store first and falls back to that, so old boards keep working.
import { list } from '@vercel/blob'
import { sql, type ProjectRow } from './db.js'

/** The shared store's prefix. Owned by no project; GC'd by the purge cron when
 *  the last project of a recording goes (api/cron/purge-trash.ts). */
export const STEMS_PREFIX = 'cache/stems/'

interface Source {
  type?: string
  videoId?: string
  driveFileId?: string
}

/** A stable key for a recording's shared media, or null for an audio-URL
 *  track (which has no id to share by). */
export function mediaKey(source: unknown): string | null {
  const s = (source ?? {}) as Source
  if (s.type === 'youtube' && s.videoId) return s.videoId
  if (s.type === 'drive' && s.driveFileId) return `drive-${s.driveFileId}`
  return null
}

/** The shared-store folder for a recording. */
export function stemFolder(key: string): string {
  return `${STEMS_PREFIX}${key}/`
}

/** The part name a stored stem file carries, e.g. `vocals-Ab3x9.m4a` → `vocals`
 *  (the `-<suffix>` is Blob's random suffix, which keeps the URL unguessable). */
export function partOf(pathname: string): string | null {
  const file = pathname.split('/').pop() ?? ''
  if (file.endsWith('.part')) return null
  const base = file.replace(/\.\w+$/, '')
  const m = base.match(/^(.+?)-[A-Za-z0-9]+$/)
  return (m ? m[1] : base) || null
}

/** The stems recorded on a project itself (analysis.stems), or null. */
export function ownStems(analysis: unknown): Record<string, string> | null {
  const s = (analysis as { stems?: unknown } | null)?.stems
  if (s && typeof s === 'object' && Object.keys(s as object).length > 0)
    return s as Record<string, string>
  return null
}

/** The stems in the shared store for a recording, by listing its folder. */
export async function sharedStems(key: string): Promise<Record<string, string> | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN
  if (!token) return null
  try {
    const page = await list({ prefix: stemFolder(key), token, limit: 20 })
    const map: Record<string, string> = {}
    for (const b of page.blobs) {
      const part = partOf(b.pathname)
      if (part && !(part in map)) map[part] = b.url
    }
    return Object.keys(map).length > 0 ? map : null
  } catch {
    return null
  }
}

/**
 * This track's stems to drive the mixer and the clip export: its own
 * (analysis.stems), else the shared store for its recording, else — for the
 * stems produced before the shared store existed — another same-video
 * project's own stems. Null when there are none to use.
 */
export async function resolveStems(row: ProjectRow): Promise<Record<string, string> | null> {
  const own = ownStems(row.analysis)
  if (own) return own
  const key = mediaKey(row.source)
  if (!key) return null

  const shared = await sharedStems(key)
  if (shared) return shared

  // Legacy: stems produced before the shared store, which live under their own
  // project's prefix. Found by the same video id through the project row.
  const source = (row.source ?? {}) as Source
  if (source.type === 'youtube' && source.videoId) {
    const rows = (await sql`
      SELECT analysis
      FROM projects
      WHERE deleted_at IS NULL
        AND source->>'type' = 'youtube'
        AND source->>'videoId' = ${source.videoId}
        AND jsonb_typeof(analysis->'stems') = 'object'
      ORDER BY (analysis->>'finishedAt')::bigint DESC NULLS LAST
      LIMIT 1
    `) as { analysis: unknown }[]
    return rows[0] ? ownStems(rows[0].analysis) : null
  }
  return null
}
