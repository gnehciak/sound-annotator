// POST /api/blobs/gc — garbage-collect a project's orphaned note images:
// delete every uploaded image whose URL no longer appears in the project's
// persisted note HTML. Safe against editor undo because the client calls it
// on load (not mid-edit) with the *saved* HTML — an image is only collected
// once it's truly gone from the notes.
import { del, list } from '@vercel/blob'
import { getUid } from '../_lib/auth.js'
import { getProjectRow } from '../_lib/db.js'
import { guestKeyFrom, guestKeyOpens, isGuestOwner } from '../_lib/guest.js'
import { json, err } from '../_lib/respond.js'

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)

  const body = (await request.json().catch(() => null)) as {
    projectId?: string
    html?: string[]
  } | null
  if (!body?.projectId || !Array.isArray(body.html))
    return err(400, 'Missing projectId or html')

  // Whose folder are we sweeping? A signed-in caller sweeps their own. A guest
  // sweeps the one project their key opens — they upload images now, so
  // without this their orphans would have no collector until the whole project
  // is purged, which for a guest track may be never.
  const owner = uid ?? (await guestOwnerFor(request, body.projectId))
  if (!owner) return err(401, 'Sign in required')

  const haystack = body.html.join('\n')
  const prefix = `users/${owner}/images/${body.projectId}/`

  let deleted = 0
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    // Match on the blob's URL — exactly the string embedded in note HTML
    // (TipTap entity-escapes &, but blob URLs carry no query string).
    const orphans = page.blobs.filter((b) => !haystack.includes(b.url))
    if (orphans.length > 0) {
      await del(orphans.map((b) => b.url))
      deleted += orphans.length
    }
    cursor = page.cursor
  } while (cursor)

  return json({ deleted })
}

/**
 * The guest owner id whose images this request may sweep, or null. Mirrors the
 * check in api/blobs/upload.ts: the key must open *this* project, and the
 * prefix is built from the row's own owner id rather than anything the client
 * claimed.
 */
async function guestOwnerFor(
  request: Request,
  projectId: string,
): Promise<string | null> {
  const key = guestKeyFrom(request)
  if (!key) return null
  const row = await getProjectRow(projectId)
  if (!row || row.deleted_at || !isGuestOwner(row.owner_id)) return null
  return (await guestKeyOpens(key, row.guest_token_hash)) ? row.owner_id : null
}
