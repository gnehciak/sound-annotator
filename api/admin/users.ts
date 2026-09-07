// GET /api/admin/users — every account, for the teacher's console.
//
// Gated exactly like api/admin/projects: an ADMIN_EMAILS allowlist checked
// server-side, and 404 rather than 403 for everyone else, so a stranger learns
// nothing about whether the page exists.
//
// Accounts live in Clerk and projects live in Postgres, and nothing joins them
// but `owner_id`. So this reads both and stitches them here: for each account,
// how many live projects it owns and when it last touched one. Guests have no
// account at all — their rows are owned by a synthetic `guest:<uuid>` — so they
// can't appear as users; they're reported once as a tally instead, which is
// what stops the numbers here from silently disagreeing with the projects tab.
import { getUid, isAdmin, listUsers } from '../_lib/auth.js'
import { sql } from '../_lib/db.js'
import { isGuestOwner } from '../_lib/guest.js'
import { json, err } from '../_lib/respond.js'

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid || !(await isAdmin(uid))) return err(404, 'Not found')

  type OwnerRow = { owner_id: string; n: number; last: string | number | null }
  const [users, counted] = await Promise.all([
    listUsers(),
    sql`
      SELECT owner_id, count(*)::int AS n, max(updated_at) AS last
      FROM projects WHERE deleted_at IS NULL GROUP BY owner_id
    `,
  ])
  const rows = counted as unknown as OwnerRow[]

  const byOwner = new Map(rows.map((r) => [r.owner_id, r]))

  // Guest rows can't belong to any account; count them apart rather than
  // dropping them, so "projects here" and the projects tab reconcile.
  let guestProjects = 0
  let guestOwners = 0
  for (const r of rows)
    if (isGuestOwner(r.owner_id)) {
      guestProjects += r.n
      guestOwners += 1
    }

  // An owner_id with no Clerk account left — a deleted account whose projects
  // outlived it. Worth surfacing: nothing else would ever mention them.
  const known = new Set(users.map((u) => u.uid))
  const orphaned = rows.filter((r) => !isGuestOwner(r.owner_id) && !known.has(r.owner_id))

  return json({
    users: users.map((u) => {
      const r = byOwner.get(u.uid)
      return {
        ...u,
        projectCount: r?.n ?? 0,
        lastProjectAt: r?.last == null ? null : Number(r.last) || null,
        isAdmin: u.uid === uid,
      }
    }),
    guestProjects,
    guestOwners,
    orphaned: orphaned.map((r) => ({ ownerId: r.owner_id, projectCount: r.n })),
  })
}
