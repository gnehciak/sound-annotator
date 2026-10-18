// GET /api/projects/:id/stems — the separated stems for a track's mixer.
//
// A project's own stems (analysis.stems, written by the admin-only detect run)
// if it has them; otherwise, for a YouTube track, the stems any *other* live
// project of the same video already produced. That fallback is what lets a
// student's own board reuse the stems a teacher generated for the same song
// without a second paid analysis — the same "shared by every project pointing
// at that video" model the audio and video caches use. The stems are public
// Blob URLs of a public recording's parts, so there is nothing to leak; the
// fence is only that a live project points at the video.
//
// Who may ask is who may read the project (the clip export's gate). A guest's
// own board is born `shared`, so their key isn't even needed.
import { getUid, isAdmin } from '../../_lib/auth.js'
import { getProjectRow } from '../../_lib/db.js'
import { guestKeyFrom, guestKeyOpens } from '../../_lib/guest.js'
import { err, json } from '../../_lib/respond.js'
import { shareRoleFor } from '../../_lib/shares.js'
import { resolveStems } from '../../_lib/stems.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/stems
}

export async function GET(request: Request): Promise<Response> {
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const row = await getProjectRow(id)
  if (!row || row.deleted_at != null) return err(404, 'Not found')

  // Same read gate as the clip export.
  let allowed = row.shared || row.editable_by_link || row.published
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

  // Its own stems, or a same-video project's (see resolveStems).
  const stems = await resolveStems(row)
  return json({ stems })
}
