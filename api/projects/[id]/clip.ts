// GET /api/projects/:id/clip?start=<s>&end=<s> — a slice of the track's
// audio as an m4a download, for a student to drop into a presentation.
//
// Who may ask is exactly who may *read* the project (the GET in index.ts):
// the owner, an admin, anyone invited by email, anyone holding a live link
// (`shared` / `editable_by_link` / `published` — which every guest project
// is), and a guest with their key. A trashed track's clips go dark with its
// links. There is no separate write to gate: nothing here changes the row.
//
// Times are in the track's own clock — clip-relative, like every note — and
// mapped back to the recording here through `clipStart`, the one thing the
// players otherwise do. The clip is cut server-side (api/_lib/media.ts) so
// only the seconds asked for travel to the browser: a whole recording is
// fetched once per warm instance and cached in /tmp, never stored anywhere.
// YouTube comes through yt-dlp; a Drive video and an audio URL are read by
// ffmpeg straight from their origin, since neither is bot-walled.
import { getUid, isAdmin } from '../../_lib/auth.js'
import { getProjectRow } from '../../_lib/db.js'
import { driveOriginUrl } from '../../_lib/driveUrl.js'
import { guestKeyFrom, guestKeyOpens } from '../../_lib/guest.js'
import { cutClip, fetchYouTubeAudio, MediaError } from '../../_lib/media.js'
import { err } from '../../_lib/respond.js'
import { shareRoleFor } from '../../_lib/shares.js'

// A YouTube fetch plus the cut is ~7 s warm; a cold instance copies 120 MB
// of binaries out of the bundle and mints a PO token first.
export const maxDuration = 120

/** The longest clip served, in seconds. A presentation wants a passage, not
 *  the concert; the cap is what keeps one link from streaming whole albums
 *  through our bandwidth. */
const MAX_CLIP_SECONDS = 600

interface Source {
  type?: string
  videoId?: string
  driveFileId?: string
  audioUrl?: string
  clipStart?: number
}

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/clip
}

function seconds(raw: string | null): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** mm:ss for the filename — `:` is not a character a filename can carry. */
function stamp(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}.${String(s).padStart(2, '0')}`
}

export async function GET(request: Request): Promise<Response> {
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const params = new URL(request.url).searchParams
  const start = seconds(params.get('start'))
  const end = seconds(params.get('end'))
  if (start == null || end == null) return err(400, 'start and end are seconds')
  if (end <= start) return err(400, 'The end has to come after the start')
  if (end - start > MAX_CLIP_SECONDS)
    return err(400, `A clip can be at most ${MAX_CLIP_SECONDS / 60} minutes long`)

  const row = await getProjectRow(id)
  if (!row || row.deleted_at != null) return err(404, 'Not found')

  const linked = row.shared || row.editable_by_link || row.published
  let allowed = linked
  if (!allowed) {
    const uid = await getUid(request)
    if (uid) {
      allowed =
        row.owner_id === uid ||
        (await shareRoleFor(row.id, uid)) != null ||
        (await isAdmin(uid))
    } else {
      const key = guestKeyFrom(request)
      allowed = !!key && (await guestKeyOpens(key, row.guest_token_hash))
    }
  }
  if (!allowed) return err(403, 'Not shared')

  const source = (row.source ?? {}) as Source
  try {
    let buf: Buffer
    if (source.type === 'youtube' && source.videoId) {
      const offset = source.clipStart ?? 0
      const file = await fetchYouTubeAudio(source.videoId)
      buf = await cutClip(file, start + offset, end + offset, { copy: true })
    } else if (source.type === 'drive' && source.driveFileId) {
      const offset = source.clipStart ?? 0
      buf = await cutClip(driveOriginUrl(source.driveFileId), start + offset, end + offset, {
        copy: false,
      })
    } else if (source.type === 'audio' && source.audioUrl) {
      buf = await cutClip(source.audioUrl, start, end, { copy: false })
    } else {
      return err(400, 'This track has no recording to clip')
    }
    const title = (row.title || 'clip').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)
    const name = `${title} ${stamp(start)}-${stamp(end)}.m4a`
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'audio/mp4',
        'Content-Length': String(buf.length),
        'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (e) {
    if (e instanceof MediaError) return err(e.status, e.message)
    console.error('[clip] unexpected', e)
    return err(500, 'The clip could not be made')
  }
}
