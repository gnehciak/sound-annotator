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
//
// `GET /api/browse?drive=<fileId>` is a second, unrelated verb on the same
// function: the byte proxy Drive videos play through (see driveStream below).
// It rides here because the Hobby plan caps a deployment at 12 Serverless
// Functions and /api is at exactly 12 — same reason restore/purge are query
// verbs on projects/[id]. Both verbs are public, which is the only thing they
// have in common.
import { sql, type ProjectRow } from './_lib/db.js'
import { err, json } from './_lib/respond.js'

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

/**
 * Where Drive actually keeps the bytes. Deliberately not imported from
 * src/lib/drive.ts — /api and /src are separate compilation units — so that
 * file carries the full reasoning and this is its server-side twin. `confirm=t`
 * is what gets a file past ~100 MB served instead of Drive's virus-scan
 * interstitial.
 */
const driveOriginUrl = (fileId: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
    fileId,
  )}&export=download&confirm=t`

/** Drive file ids, same floor as src/lib/drive.ts. */
const FILE_ID = /^[a-zA-Z0-9_-]{16,}$/

/**
 * File ids already found on a live project, remembered for the life of this
 * instance. A media element asks for dozens of ranges per video and the answer
 * can only change when a track is created or trashed, so re-asking Postgres
 * each time would put a query in front of every seek for nothing. Only hits are
 * cached: a miss is the case that flips (a track being saved right now — see
 * DrivePlayer's retry), and caching it would make the retry pointless.
 */
const known = new Set<string>()
const KNOWN_MAX = 500

async function isOnALiveProject(fileId: string): Promise<boolean> {
  if (known.has(fileId)) return true
  const rows = (await sql`
    SELECT 1 FROM projects
    WHERE deleted_at IS NULL AND source->>'driveFileId' = ${fileId}
    LIMIT 1
  `) as unknown[]
  if (rows.length === 0) return false
  // A warm instance shouldn't grow a set without end.
  if (known.size >= KNOWN_MAX) known.clear()
  known.add(fileId)
  return true
}

/**
 * Stream a Google Drive video's bytes through our own origin.
 *
 * Drive refuses to serve its download endpoint to a browser: every subresource
 * loaded from another origin carries `Sec-Fetch-Site: cross-site`, which Drive
 * answers 403, and any `Referer` from a non-Google page gets the virus-scan
 * interstitial instead of video. Page JS can't suppress either header, so a
 * `<video>` pointed straight at Drive can only fail — see src/lib/drive.ts.
 * A server fetch sends neither, and gets the real bytes.
 *
 * Two things this is not. It is **not** an open proxy: the file id has to be
 * one a live project already points at, so the endpoint can't be used as a
 * general-purpose CDN for arbitrary public Drive files. And it is **not**
 * authorization — the file is public on Drive by necessity, so there is
 * nothing here to protect; the check is a bandwidth fence, not a gate.
 *
 * The Range header is passed straight through rather than cut into fixed
 * windows. Reaching Drive costs a couple of seconds of handshake whatever you
 * ask it for, so any chunk small enough to bound a response is small enough to
 * make the player crawl; and the player already bounds its own reads — it asks
 * for `bytes=0-`, takes what it wants and hangs up. Which is why `req.signal`
 * has to reach the upstream fetch: without it a client that hangs up after a
 * second leaves us pulling the rest of its window from Drive for nothing.
 */
async function driveStream(fileId: string, req: Request): Promise<Response> {
  if (!FILE_ID.test(fileId)) return err(400, 'Not a Drive file id')
  if (!(await isOnALiveProject(fileId)))
    return err(404, 'No track points at that Drive file')

  const range = req.headers.get('range')
  let upstream: Response
  try {
    upstream = await fetch(driveOriginUrl(fileId), {
      headers: range ? { Range: range } : {},
      redirect: 'follow',
      signal: req.signal,
    })
  } catch {
    // Includes the ordinary case of the player hanging up mid-buffer, which
    // aborts this fetch: nobody is left to read the answer either way.
    return err(502, 'Drive did not answer')
  }

  // Drive says no in HTML — an unshared file, a download quota, a folder id.
  // Whatever it is, it isn't video, and letting it through would reach the
  // player as an unreadable "format error".
  const type = upstream.headers.get('content-type') ?? ''
  if (!upstream.ok || type.startsWith('text/html')) {
    void upstream.body?.cancel()
    return err(
      502,
      upstream.status === 403 || type.startsWith('text/html')
        ? 'Drive would not serve this file — check that it is shared with Anyone with the link'
        : `Drive answered ${upstream.status}`,
    )
  }

  const out = new Headers({
    'Content-Type': type || 'video/mp4',
    // Seeking depends on this being true of us, not of Drive.
    'Accept-Ranges': 'bytes',
    // Never a shared cache: these responses are partial and range-specific,
    // and a CDN that ignored that would hand a player the wrong window.
    'Cache-Control': 'private, max-age=3600',
  })
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

export async function GET(req: Request): Promise<Response> {
  const driveFileId = new URL(req.url).searchParams.get('drive')
  if (driveFileId) return driveStream(driveFileId, req)

  const rows = (await sql`
    SELECT id, owner_id, title, source, annotations, updated_at,
           published_at, published_by_name
    FROM projects WHERE published AND deleted_at IS NULL
    ORDER BY published_at DESC NULLS LAST
    LIMIT 200
  `) as ProjectRow[]

  return json(
    rows.map((r) => {
      const src = (r.source ?? {}) as {
        type?: string
        videoId?: string
        driveFileId?: string
      }
      const { ticks, count } = ticksOf(r.annotations)
      return {
        id: r.id,
        ownerId: r.owner_id,
        title: r.title,
        sourceType: src.type ?? null,
        videoId: src.type === 'youtube' ? src.videoId ?? null : null,
        driveFileId: src.type === 'drive' ? src.driveFileId ?? null : null,
        noteCount: count,
        ticks,
        publishedByName: r.published_by_name ?? 'A teacher',
        publishedAt: Number(r.published_at) || 0,
        updatedAt: Number(r.updated_at) || 0,
      }
    }),
  )
}
