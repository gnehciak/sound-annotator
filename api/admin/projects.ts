// GET /api/admin/projects — every project in the database, for the teacher's
// console (src/components/AdminProjects.tsx).
//
// This is the one endpoint that lists projects the caller doesn't own, so it is
// gated hard: an ADMIN_EMAILS allowlist, checked server-side on every call (see
// _lib/auth.ts). A non-admin gets 404, not 403 — there is nothing to be gained
// by confirming the page exists to someone who can't use it.
//
// Reading and editing happen through the normal /api/projects/:id routes, which
// grant admins owner rights; deleting goes through [id]/trash.ts DELETE, the
// purge (this console is the one caller that skips the trash). This endpoint
// only answers "what exists", which nothing else can — guest owners are
// synthetic, and an account's library is otherwise visible only to that account.
import { getUid, isAdmin } from '../_lib/auth.js'
import { sql, rowToProject, type ProjectRow } from '../_lib/db.js'
import { isGuestOwner } from '../_lib/guest.js'
import { json, err } from '../_lib/respond.js'

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid || !(await isAdmin(uid))) return err(404, 'Not found')

  // Trashed projects are left out: this console moderates what's live, and a
  // trashed row is already dark everywhere a student could reach it. Listing
  // one beside live projects would say it's still out there when it isn't —
  // and it isn't the console's to bury either, since its owner may yet restore
  // it. Whatever nobody restores, api/cron/purge-trash.ts collects.
  const rows = (await sql`
    SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY updated_at DESC
  `) as ProjectRow[]

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
