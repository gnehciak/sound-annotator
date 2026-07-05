// PUT / DELETE /api/folders/:id — create-or-rename and delete, owner only.
import { getUid } from '../_lib/auth.js'
import { sql, type FolderRow } from '../_lib/db.js'
import { json, err } from '../_lib/respond.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/folders/<id>
}

export async function PUT(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing folder id')

  const body = (await request.json().catch(() => null)) as {
    name?: string
    createdAt?: number
  } | null
  if (!body || typeof body.name !== 'string') return err(400, 'Missing name')

  const rows = (await sql`SELECT * FROM folders WHERE id = ${id}`) as FolderRow[]
  if (rows[0] && rows[0].owner_id !== uid) return err(403, 'Not yours')

  await sql`
    INSERT INTO folders (id, owner_id, name, created_at)
    VALUES (${id}, ${uid}, ${body.name},
            ${typeof body.createdAt === 'number' ? body.createdAt : 0})
    ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name, created_at = EXCLUDED.created_at
      WHERE folders.owner_id = ${uid}
  `
  return json({ ok: true })
}

export async function DELETE(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing folder id')
  await sql`DELETE FROM folders WHERE id = ${id} AND owner_id = ${uid}`
  return json({ ok: true })
}
