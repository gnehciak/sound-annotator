// POST / DELETE /api/projects/:id/trash — the two ways out of the trash.
//
// - POST:   restore. `deleted_at` goes back to NULL and the project reappears
//           in the library exactly as it left: same notes, same images, same
//           share and publish state, since none of that was touched on the way
//           in (see [id]/index.ts DELETE).
// - DELETE: purge. The real, irreversible delete — the row goes for good. The
//           client tears down the project's blobs alongside this call
//           (App.tsx's purgeProject); api/cron/purge-trash.ts does its own.
//
// Owner only, both, and both refuse to touch a live project: a purge is
// reachable only through the trash, so no stray call can hard-delete a track
// that was never deleted. Admins get no say here — their power is over guest
// projects, and those never enter the trash ([id]/index.ts).
import { getUid } from '../../_lib/auth.js'
import { sql } from '../../_lib/db.js'
import { json, err } from '../../_lib/respond.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/trash
}

/** Restore a trashed project to the library. */
export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')

  await sql`
    UPDATE projects SET deleted_at = NULL
    WHERE id = ${id} AND owner_id = ${uid} AND deleted_at IS NOT NULL
  `
  return json({ ok: true })
}

/** Delete a trashed project for good. */
export async function DELETE(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')

  await sql`
    DELETE FROM projects
    WHERE id = ${id} AND owner_id = ${uid} AND deleted_at IS NOT NULL
  `
  return json({ ok: true })
}
