// POST /api/projects/:id/lock — claim / heartbeat / take-over / release.
//
// Lock-only writes are last-write-wins by design (the old rules allowed them
// unconditionally for anyone who may edit): a take-over simply claims, and
// the loser's next poll flips its UI to read-only. Only the lock column is
// touched, so a claim can never clobber content. `at` is stamped here,
// server-side — the client's clock is never trusted.
import { getUid } from '../../_lib/auth.js'
import { sql, getProjectRow, jsonb, type LockValue } from '../../_lib/db.js'
import { guestKeyFrom, guestKeyOpens } from '../../_lib/guest.js'
import { json, err } from '../../_lib/respond.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/lock
}

interface LockBody {
  action?: 'claim' | 'release'
  sessionId?: string
  name?: string
}

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')

  const body = (await request.json().catch(() => null)) as LockBody | null
  if (!body || typeof body.sessionId !== 'string') return err(400, 'Missing sessionId')

  const row = await getProjectRow(id)
  // A brand-new project's lock subscription starts before the first save
  // creates the row — 404 is expected noise the client swallows.
  if (!row) return err(404, 'Not found')

  // Guests hold the lock too: a student with two tabs open deserves the same
  // protection from clobbering themselves as anyone else. Their principal is
  // the row's own synthetic owner (see _lib/guest.ts).
  const guestKey = uid ? null : guestKeyFrom(request)
  const isGuest = guestKey != null && (await guestKeyOpens(guestKey, row.guest_token_hash))
  if (!uid && !isGuest) return err(401, 'Sign in required')
  const principal = uid ?? row.owner_id
  if (!isGuest && row.owner_id !== uid && row.editable_by_link !== true)
    return err(403, 'Not editable')

  if (body.action === 'release') {
    // Only the holder's own release clears the lock; a stranger's stale
    // release must not free a live claim out from under the editor.
    await sql`
      UPDATE projects SET lock = NULL
      WHERE id = ${id} AND lock->>'sessionId' = ${body.sessionId}
    `
    return json({ lock: null })
  }

  const lock: LockValue = {
    sessionId: body.sessionId,
    uid: principal,
    name: typeof body.name === 'string' ? body.name : 'Someone',
    at: Date.now(),
  }
  await sql`UPDATE projects SET lock = ${jsonb(lock)}::jsonb WHERE id = ${id}`
  return json({ lock })
}
