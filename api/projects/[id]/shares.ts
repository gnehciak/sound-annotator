// GET / POST / DELETE /api/projects/:id/shares — the project's invite list.
//
// Owner only, all three verbs: who may open a track is the owner's call, and an
// invited editor being able to invite further editors would make the list a
// thing the owner can no longer read off their own screen. (The admin console
// stands in as owner elsewhere, but deliberately not here — an allowlist that
// can hard-delete work has no business quietly widening access to it.)
//
// POST is an upsert: inviting an address that is already on the list changes
// its role, which is what "set them to Editor" means from the panel. DELETE
// takes the address in the query string (?email=…) since a DELETE body is not
// carried reliably by every client.
import { getUid } from '../../_lib/auth.js'
import { sql, getProjectRow } from '../../_lib/db.js'
import {
  asRole,
  listShares,
  normalizeEmail,
  shareToJson,
} from '../../_lib/shares.js'
import { json, err } from '../../_lib/respond.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/shares
}

/** The owner's row, or the response to send instead. Resolves alias → real id,
 *  so nothing downstream can write a share against an identifier the purge
 *  sweeps don't know. */
async function ownedRow(
  request: Request,
): Promise<{ id: string } | { fail: Response }> {
  const uid = await getUid(request)
  if (!uid) return { fail: err(401, 'Sign in required') }
  const id = idFrom(request)
  if (!id) return { fail: err(400, 'Missing project id') }
  const row = await getProjectRow(id)
  // 404 rather than 403 for a project that isn't theirs: to a stranger the
  // difference between "not yours" and "not there" is nothing they can act on,
  // and the ids are unguessable anyway.
  if (!row || row.owner_id !== uid || row.deleted_at != null)
    return { fail: err(404, 'Not found') }
  return { id: row.id }
}

export async function GET(request: Request): Promise<Response> {
  const r = await ownedRow(request)
  if ('fail' in r) return r.fail
  return json((await listShares(r.id)).map(shareToJson))
}

export async function POST(request: Request): Promise<Response> {
  const r = await ownedRow(request)
  if ('fail' in r) return r.fail
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const email = normalizeEmail(body?.email)
  if (!email) return err(400, 'Enter a valid email address')
  const role = asRole(body?.role)
  await sql`
    INSERT INTO project_shares (project_id, email, role, invited_at)
    VALUES (${r.id}, ${email}, ${role}, ${Date.now()})
    ON CONFLICT (project_id, email) DO UPDATE SET role = ${role}
  `
  return json((await listShares(r.id)).map(shareToJson))
}

export async function DELETE(request: Request): Promise<Response> {
  const r = await ownedRow(request)
  if ('fail' in r) return r.fail
  const email = normalizeEmail(new URL(request.url).searchParams.get('email'))
  if (!email) return err(400, 'Missing email')
  await sql`
    DELETE FROM project_shares WHERE project_id = ${r.id} AND email = ${email}
  `
  return json((await listShares(r.id)).map(shareToJson))
}
