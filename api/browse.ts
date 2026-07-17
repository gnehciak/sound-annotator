// GET /api/browse — the public gallery: every published project, newest
// first. No auth: publishing is an explicit opt-in to public listing (unlike
// `shared`, which stays unlisted by design — see api/projects/index.ts).
//
// Trashed projects delist here immediately and relist on restore: `published`
// survives a trip through the trash untouched, so the gallery is the live
// projects that are published, never the column alone.
//
// The payload is deliberately light. Note HTML (which can carry many inline
// image URLs) never leaves this endpoint — the cue line only needs each
// note's position and colour, and the card only needs a count.
import { sql, type ProjectRow } from './_lib/db.js'
import { json } from './_lib/respond.js'

interface Tick {
  id: string
  start: number
  end?: number
  color?: string
}

function ticksOf(annotations: unknown): { ticks: Tick[]; count: number } {
  if (!Array.isArray(annotations)) return { ticks: [], count: 0 }
  const ticks = annotations
    .filter((a) => a && typeof a.start === 'number')
    .slice(0, 400)
    .map((a) => ({
      id: String(a.id ?? ''),
      start: a.start as number,
      ...(typeof a.end === 'number' ? { end: a.end } : {}),
      ...(typeof a.color === 'string' ? { color: a.color } : {}),
    }))
  return { ticks, count: annotations.length }
}

export async function GET(): Promise<Response> {
  const rows = (await sql`
    SELECT id, owner_id, title, source, annotations, updated_at,
           published_at, published_by_name
    FROM projects WHERE published AND deleted_at IS NULL
    ORDER BY published_at DESC NULLS LAST
    LIMIT 200
  `) as ProjectRow[]

  return json(
    rows.map((r) => {
      const src = (r.source ?? {}) as { type?: string; videoId?: string }
      const { ticks, count } = ticksOf(r.annotations)
      return {
        id: r.id,
        ownerId: r.owner_id,
        title: r.title,
        sourceType: src.type ?? null,
        videoId: src.type === 'youtube' ? src.videoId ?? null : null,
        noteCount: count,
        ticks,
        publishedByName: r.published_by_name ?? 'A teacher',
        publishedAt: Number(r.published_at) || 0,
        updatedAt: Number(r.updated_at) || 0,
      }
    }),
  )
}
