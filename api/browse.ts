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
// function: the byte proxy Drive files come through (see driveStream below) —
// a track's video, or, with `&pdf=1`, its PDF score. It rides here because the
// Hobby plan caps a deployment at 12 Serverless Functions and /api is at
// exactly 12 — same reason restore/purge are query verbs on projects/[id].
// Both verbs are public, which is the only thing they have in common.
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

/** Ceiling on a proxied score, mirroring src/lib/score.ts. An upload is
 *  checked before it is stored; a Drive link is only ever checked here. */
const SCORE_MAX_BYTES = 30 * 1024 * 1024

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

/**
 * Whether any live track points at this Drive file — as its video *or* as its
 * PDF score (settings.score, see src/lib/score.ts). Both are the same fence:
 * the file is already public on Drive, so there is nothing here to protect;
 * the check exists so the endpoint can't be used as a general-purpose CDN for
 * arbitrary Drive files at our expense.
 */
async function isOnALiveProject(fileId: string): Promise<boolean> {
  if (known.has(fileId)) return true
  const rows = (await sql`
    SELECT 1 FROM projects
    WHERE deleted_at IS NULL
      AND (source->>'driveFileId' = ${fileId}
           OR settings->'score'->>'driveFileId' = ${fileId})
    LIMIT 1
  `) as unknown[]
  if (rows.length === 0) return false
  // A warm instance shouldn't grow a set without end.
  if (known.size >= KNOWN_MAX) known.clear()
  known.add(fileId)
  return true
}

/**
 * Stream a Google Drive file's bytes through our own origin — a track's video,
 * or (`pdf`) the PDF score laid over it.
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
 * For video the Range header is passed straight through rather than cut into
 * fixed windows. Reaching Drive costs a couple of seconds of handshake whatever
 * you ask it for, so any chunk small enough to bound a response is small enough
 * to make the player crawl; and the player already bounds its own reads — it
 * asks for `bytes=0-`, takes what it wants and hangs up. Which is why
 * `req.signal` has to reach the upstream fetch: without it a client that hangs
 * up after a second leaves us pulling the rest of its window from Drive for
 * nothing.
 *
 * A score is the opposite case and is handled differently on both counts. It
 * is fetched whole (the reader asks for the bytes once — see src/lib/pdf.ts —
 * so there is no range to honour and no reason to invite dozens of them), and
 * it is *shared*-cacheable, which video's range-specific answers can never be.
 * That cache is what keeps a class of thirty opening one score down to a
 * single fetch from Drive; a short s-maxage plus the reader's `&v=` buster is
 * what keeps "annotate it in Drive and everyone sees the new version" true.
 */
async function driveStream(
  fileId: string,
  req: Request,
  pdf: boolean,
): Promise<Response> {
  if (!FILE_ID.test(fileId)) return err(400, 'Not a Drive file id')
  if (!(await isOnALiveProject(fileId)))
    return err(404, 'No track points at that Drive file')

  const range = pdf ? null : req.headers.get('range')
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
  // Whatever it is, it isn't the file, and letting it through would reach the
  // reader as an unreadable "format error".
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

  if (pdf) {
    const wrong = wrongForPdf(type, upstream.headers.get('content-length'))
    if (wrong) {
      void upstream.body?.cancel()
      return err(502, wrong)
    }
  }

  const out = new Headers({
    'Content-Type': pdf ? 'application/pdf' : type || 'video/mp4',
    // Seeking depends on this being true of us, not of Drive.
    ...(pdf ? {} : { 'Accept-Ranges': 'bytes' }),
    // A score is one whole immutable-ish document, so the edge may hold it;
    // five minutes bounds how stale a freshly annotated score can be, and the
    // reader's Reload (a changed `v=`) is the way past it immediately. Video
    // can never be shared-cached: its answers are partial and range-specific,
    // and a CDN that ignored that would hand a player the wrong window.
    'Cache-Control': pdf
      ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'
      : 'private, max-age=3600',
  })
  for (const h of ['content-length', 'content-range', 'etag', 'last-modified']) {
    if (pdf && h === 'content-range') continue
    const v = upstream.headers.get(h)
    if (v) out.set(h, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: out })
}

/**
 * Why these bytes can't be served as a score, or null when they can. Drive
 * labels a PDF `application/pdf`, but hands some files out as a bare
 * octet-stream — which pdf.js can still read, so it passes and anything
 * plainly else (a video, an image, a zip) does not.
 */
function wrongForPdf(type: string, length: string | null): string | null {
  const kind = type.split(';')[0].trim().toLowerCase()
  if (kind && kind !== 'application/pdf' && kind !== 'application/octet-stream')
    return 'That Drive file is not a PDF.'
  const bytes = Number(length)
  if (Number.isFinite(bytes) && bytes > SCORE_MAX_BYTES)
    return `That PDF is ${Math.round(bytes / 1024 / 1024)} MB — the limit is ${Math.round(
      SCORE_MAX_BYTES / 1024 / 1024,
    )} MB.`
  return null
}

export async function GET(req: Request): Promise<Response> {
  const params = new URL(req.url).searchParams
  const driveFileId = params.get('drive')
  if (driveFileId) return driveStream(driveFileId, req, params.get('pdf') === '1')

  const rows = (await sql`
    SELECT id, alias, owner_id, title, source, annotations, updated_at,
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
        alias: r.alias ?? undefined,
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
