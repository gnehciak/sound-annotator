// POST / DELETE /api/projects/:id/trash — the two ways out of the trash.
//
// - POST:   restore. `deleted_at` goes back to NULL and the project reappears
//           in the library exactly as it left: same notes, same images, same
//           share and publish state, since none of that was touched on the way
//           in (see [id]/index.ts DELETE).
// - DELETE: purge. The real, irreversible delete — the row goes for good. The
//           client tears down the project's blobs alongside this call
//           (App.tsx's purgeProject, AdminProjects' remove);
//           api/cron/purge-trash.ts does its own.
//
// This is the app's one and only hard delete, which is why both the owner's
// "Delete forever" and the admin console's permanent delete come through it.
// They differ in reach, and only here:
//
// - An owner may purge only their own project, and only from the trash. A
//   purge is unreachable except through the trash, so no stray call can
//   hard-delete a track that was never deleted.
// - A teacher-admin may purge any row, trashed or live — the console's whole
//   point is removing a project outright, and it says so ("cannot be undone")
//   before tearing down the bytes.
import { getUid, isAdmin } from '../../_lib/auth.js'
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

/** Delete a project for good: the owner's own, out of their trash — or, for a
 *  teacher-admin, any project at all (the console's permanent delete). */
export async function DELETE(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')

  // The console deletes live projects outright — that's the one caller allowed
  // to skip the trash, and it owns the "cannot be undone" confirm that says so.
  if (await isAdmin(uid)) {
    await sql`DELETE FROM projects WHERE id = ${id}`
    return json({ ok: true })
  }

  await sql`
    DELETE FROM projects
    WHERE id = ${id} AND owner_id = ${uid} AND deleted_at IS NOT NULL
  `
  return json({ ok: true })
}
