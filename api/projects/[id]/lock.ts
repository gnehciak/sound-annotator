// POST /api/projects/:id/lock — claim / heartbeat / take-over / release.
//
// A claim (and so a take-over) is last-write-wins by design (the old rules
// allowed it unconditionally for anyone who may edit): a take-over simply
// claims, and the loser's next poll flips its UI to read-only. A heartbeat is
// *not*: it renews the lock only while this session still holds it (or the
// lock is free or stale), and answers with whoever holds it either way — so
// a holder's routine renewal can never undo somebody's take-over, and the
// reply itself tells the loser it lost. Only the lock column is
// touched, so a claim can never clobber content. `at` is stamped here,
// server-side — the client's clock is never trusted.
import { getUid } from '../../_lib/auth.js'
import { sql, getProjectRow, jsonb, LOCK_LIVE_MS, type LockValue } from '../../_lib/db.js'
import { guestKeyFrom, guestKeyOpens } from '../../_lib/guest.js'
import { json, err } from '../../_lib/respond.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/lock
}

interface LockBody {
  action?: 'claim' | 'heartbeat' | 'release'
  sessionId?: string
  name?: string
}

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)
  const ref = idFrom(request)
  if (!ref) return err(400, 'Missing project id')

  const body = (await request.json().catch(() => null)) as LockBody | null
  if (!body || typeof body.sessionId !== 'string') return err(400, 'Missing sessionId')

  const row = await getProjectRow(ref)
  // A brand-new project's lock subscription starts before the first save
  // creates the row — 404 is expected noise the client swallows.
  if (!row) return err(404, 'Not found')
  // `ref` may be the short alias; lock writes go by the real key.
  const id = row.id

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
  if (body.action === 'heartbeat') {
    const cutoff = lock.at - LOCK_LIVE_MS
    const renewed = await sql`
      UPDATE projects SET lock = ${jsonb(lock)}::jsonb
      WHERE id = ${id} AND (
        lock IS NULL
        OR lock->>'sessionId' = ${body.sessionId}
        OR COALESCE((lock->>'at')::bigint, 0) < ${cutoff}
      )
      RETURNING id
    `
    if (renewed.length > 0) return json({ lock })
    const [cur] = await sql`SELECT lock FROM projects WHERE id = ${id}`
    return json({ lock: (cur?.lock ?? null) as LockValue | null })
  }

  await sql`UPDATE projects SET lock = ${jsonb(lock)}::jsonb WHERE id = ${id}`
  return json({ lock })
}
