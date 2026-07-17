// GET /api/admin/projects — every project in the database, for the teacher's
// console (src/components/AdminProjects.tsx).
//
// This is the one endpoint that lists projects the caller doesn't own, so it is
// gated hard: an ADMIN_EMAILS allowlist, checked server-side on every call (see
// _lib/auth.ts). A non-admin gets 404, not 403 — there is nothing to be gained
// by confirming the page exists to someone who can't use it.
//
// Reading, editing and deleting happen through the normal /api/projects/:id
// routes, which grant admins owner rights; this only answers "what exists",
// which nothing else can — guest owners are synthetic, and an account's library
// is otherwise visible only to that account.
import { getUid, isAdmin } from '../_lib/auth.js'
import { sql, rowToProject, type ProjectRow } from '../_lib/db.js'
import { isGuestOwner } from '../_lib/guest.js'
import { json, err } from '../_lib/respond.js'

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid || !(await isAdmin(uid))) return err(404, 'Not found')

  const rows = (await sql`SELECT * FROM projects ORDER BY updated_at DESC`) as ProjectRow[]

  // rowToProject never surfaces guest_token_hash — an admin can delete a
  // student's project, but not silently acquire their private edit link.
  return json(
    rows.map((r) => ({
      ...rowToProject(r),
      noteCount: Array.isArray(r.annotations) ? r.annotations.length : 0,
      kind: isGuestOwner(r.owner_id) ? 'guest' : 'account',
      // Whose blobs these are decides whether deleting can clean them up: the
      // delete endpoint is scoped to the caller's own users/{uid}/ prefix
      // unless they're an admin (see api/blobs/delete.ts).
      mine: r.owner_id === uid,
    })),
  )
}
