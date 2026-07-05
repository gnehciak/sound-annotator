// GET /api/folders — the signed-in user's home-page folders. Folders are
// private to their owner; unlike projects there is no share-by-link exception.
import { getUid } from '../_lib/auth.js'
import { sql, rowToFolder, type FolderRow } from '../_lib/db.js'
import { json, err } from '../_lib/respond.js'

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const rows = (await sql`
    SELECT * FROM folders WHERE owner_id = ${uid}
  `) as FolderRow[]
  return json(rows.map(rowToFolder))
}
