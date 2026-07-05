// GET /api/projects — every project owned by the signed-in user.
// (Only the owner may list; strangers can fetch single shared docs by id —
// see [id]/index.ts — so unlisted links never become a public directory.)
import { getUid } from '../_lib/auth.js'
import { sql, rowToProject, type ProjectRow } from '../_lib/db.js'
import { json, err } from '../_lib/respond.js'

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const rows = (await sql`
    SELECT * FROM projects WHERE owner_id = ${uid} ORDER BY updated_at DESC
  `) as ProjectRow[]
  return json(rows.map((r) => rowToProject(r)))
}
