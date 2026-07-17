// GET /api/projects — every live project owned by the signed-in user, or, with
// ?trash=1, everything they've moved to the trash.
// (Only the owner may list; strangers can fetch single shared docs by id —
// see [id]/index.ts — so unlisted links never become a public directory.)
import { getUid } from '../_lib/auth.js'
import { sql, rowToProject, type ProjectRow } from '../_lib/db.js'
import { json, err } from '../_lib/respond.js'

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  // The two listings are disjoint, and the home page holds them in separate
  // state, so a trashed track can never turn up in search, a folder's tally,
  // or the undo history. The trash reads newest-deleted first: that's the
  // order a mis-click wants to be found in.
  const trash = new URL(request.url).searchParams.get('trash') === '1'
  const rows = (await (trash
    ? sql`
        SELECT * FROM projects
        WHERE owner_id = ${uid} AND deleted_at IS NOT NULL
        ORDER BY deleted_at DESC
      `
    : sql`
        SELECT * FROM projects
        WHERE owner_id = ${uid} AND deleted_at IS NULL
        ORDER BY updated_at DESC
      `)) as ProjectRow[]
  return json(rows.map((r) => rowToProject(r)))
}
