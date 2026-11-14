// The downloaded-video endpoint — "download the video and play the downloaded
// copy." Only ever for a YouTube source: a Drive video and an audio URL stream
// straight into a media element already, so there is nothing to download.
//
// Three verbs on one function (the "query verbs on one resource" shape /api
// uses throughout), gated differently because they cost differently:
//
//  GET …/video?probe=1  → { available, size? }. Is a copy stored? Cheap (one
//      Blob list), so the client can ask on open to decide whether to offer
//      "Download" or "Play downloaded". Who may read the project may probe.
//  GET …/video          → a 302 to a presigned link (12 h) on the private
//      Sydney cache store, which the `<video>` then plays and seeks against
//      directly. Same reader gate as the clip export — the stored copy is a
//      whole recording, so unlike the Drive proxy it is NOT public; no lasting
//      URL to it is ever handed out. 404 until it has been downloaded.
//  POST …/video         → download it. Heavy (minutes of yt-dlp + a merge + a
//      Blob write of hundreds of MB), and it hosts video bytes, so it is the
//      owner's (or an admin's) call alone — not a guest, not a link editor.
//      Streams newline-delimited JSON progress while it works.
import { getUid, isAdmin } from '../../_lib/auth.js'
import { getProjectRow } from '../../_lib/db.js'
import { guestKeyFrom, guestKeyOpens } from '../../_lib/guest.js'
import {
  downloadYouTubeVideo,
  findStoredVideo,
  MediaError,
  storeVideo,
  VIDEO_QUALITY_HEIGHTS,
  videoLink,
} from '../../_lib/media.js'
import { rmSync } from 'node:fs'
import { err, json } from '../../_lib/respond.js'
import { shareRoleFor } from '../../_lib/shares.js'

// A cold instance copies ~120 MB of binaries out of the bundle and mints a PO
// token before the download even starts; a long video then takes minutes.
export const maxDuration = 300

/** How long a playback link works. Long enough for a lesson or a school day
 *  in one tab; a fresh load asks again and is checked again. */
const VIDEO_LINK_TTL_MS = 12 * 60 * 60 * 1000

interface Source {
  type?: string
  videoId?: string
}

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/video
}

/** The YouTube id this project is of, or null when it isn't a YouTube track. */
function youtubeIdOf(source: Source): string | null {
  return source.type === 'youtube' && source.videoId ? source.videoId : null
}

/** May the caller read this project? The clip export's exact gate. */
async function mayRead(
  request: Request,
  row: NonNullable<Awaited<ReturnType<typeof getProjectRow>>>,
): Promise<boolean> {
  if (row.shared || row.editable_by_link || row.published) return true
  const uid = await getUid(request)
  if (uid) {
    return (
      row.owner_id === uid ||
      (await shareRoleFor(row.id, uid)) != null ||
      (await isAdmin(uid))
    )
  }
  const key = guestKeyFrom(request)
  return !!key && (await guestKeyOpens(key, row.guest_token_hash))
}

export async function GET(request: Request): Promise<Response> {
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const row = await getProjectRow(id)
  if (!row || row.deleted_at != null) return err(404, 'Not found')
  if (!(await mayRead(request, row))) return err(403, 'Not shared')

  const videoId = youtubeIdOf((row.source ?? {}) as Source)
  if (!videoId) return err(400, 'This track has no YouTube video to download')

  const probe = new URL(request.url).searchParams.get('probe') === '1'
  const stored = await findStoredVideo(videoId)
  if (probe) return json({ available: !!stored, size: stored?.size })
  if (!stored) return err(404, 'No downloaded copy yet')

  // Send the player straight to the store with a link that lapses: the bytes
  // go Blob → reader in one hop, from Sydney, instead of through this function
  // (which paid origin transfer on every byte and read each one from Blob
  // first — the app's largest cost, measured Nov 2026). The `<video>` follows
  // the redirect and seeks by Range against the store itself. The link outlives
  // a school day so a tab left open keeps playing; access is still decided
  // here, per request, so a trashed or unshared track's next load is refused.
  try {
    const link = await videoLink(stored, VIDEO_LINK_TTL_MS)
    return new Response(null, {
      status: 302,
      headers: { Location: link, 'Cache-Control': 'private, no-store' },
    })
  } catch (e) {
    console.error('[video] link failed:', e)
    return err(502, 'The stored video could not be read')
  }
}

export async function POST(request: Request): Promise<Response> {
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const row = await getProjectRow(id)
  if (!row || row.deleted_at != null) return err(404, 'Not found')

  // The owner (or an admin) alone — downloading hosts video bytes at our cost,
  // so it is not a reader's or a link editor's action.
  const uid = await getUid(request)
  if (!uid || !(row.owner_id === uid || (await isAdmin(uid))))
    return err(403, 'Only the track owner can download its video')

  const videoId = youtubeIdOf((row.source ?? {}) as Source)
  if (!videoId) return err(400, 'This track has no YouTube video to download')

  // Quality: a max height (360/480/720/1080) or "best"; default 720p so a long
  // video doesn't quietly pull the largest master it can find.
  const q = new URL(request.url).searchParams.get('q')
  const n = Number(q)
  const maxHeight =
    q === 'best' ? undefined : (VIDEO_QUALITY_HEIGHTS as readonly number[]).includes(n) ? n : 720

  // Already there? Say so without spending a download.
  const existing = await findStoredVideo(videoId)
  if (existing) return json({ available: true, size: existing.size })

  // The download runs for minutes, so stream progress as newline-delimited
  // JSON: {type:"progress",…} while it works, then {type:"done",…} or
  // {type:"error",…}. (The 4xx guards above still answer as plain JSON.)
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(obj) + '\n'))
        } catch {
          /* client disconnected */
        }
      }
      let workDir: string | null = null
      try {
        const media = await downloadYouTubeVideo(videoId, {
          maxHeight,
          onProgress: (p) => send({ type: 'progress', ...p }),
        })
        workDir = media.workDir
        send({ type: 'progress', stage: 'save' })
        const stored = await storeVideo(videoId, media.file, media.ext)
        send({
          type: 'done',
          available: true,
          size: stored.size,
          width: media.width,
          height: media.height,
          duration: media.duration,
        })
      } catch (e) {
        const msg = e instanceof MediaError ? e.message : 'The video could not be downloaded.'
        if (!(e instanceof MediaError)) console.error('[video] download failed:', e)
        send({ type: 'error', error: msg })
      } finally {
        if (workDir) {
          try {
            rmSync(workDir, { recursive: true, force: true })
          } catch {
            /* fine */
          }
        }
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}
