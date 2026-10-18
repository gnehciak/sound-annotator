// Resolving a track's separated stems, own or borrowed. A project's own stems
// live in analysis.stems (written by the admin-only detect run). A YouTube
// track with none can borrow the stems any other live project of the same
// video already made — the same "shared by every project pointing at that
// video" model the audio and video caches use — so a student's board reuses a
// teacher's stems with no second paid analysis, both to play (the mixer, via
// api/projects/[id]/stems.ts) and to clip (api/projects/[id]/clip.ts).
import { sql, type ProjectRow } from './db.js'

/** The stems stored on a project itself, or null when it has none. */
export function ownStems(analysis: unknown): Record<string, string> | null {
  const s = (analysis as { stems?: unknown } | null)?.stems
  if (s && typeof s === 'object' && Object.keys(s as object).length > 0)
    return s as Record<string, string>
  return null
}

/**
 * This project's stems, or — for a YouTube track with none — the newest
 * finished analysis of the same video id. Null when there are none to use.
 */
export async function resolveStems(row: ProjectRow): Promise<Record<string, string> | null> {
  const own = ownStems(row.analysis)
  if (own) return own
  const source = (row.source ?? {}) as { type?: string; videoId?: string }
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
