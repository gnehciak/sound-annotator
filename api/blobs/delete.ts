// POST /api/blobs/delete — delete every blob under a prefix, scoped to the
// caller's own users/{uid}/ space. Used when audio is removed and when a
// project (and its images) is deleted.
import { del, list } from '@vercel/blob'
import { getUid } from '../_lib/auth'
import { json, err } from '../_lib/respond'

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')

  const body = (await request.json().catch(() => null)) as { prefix?: string } | null
  const prefix = body?.prefix
  if (!prefix || typeof prefix !== 'string') return err(400, 'Missing prefix')
  if (!prefix.startsWith(`users/${uid}/`))
    return err(403, 'Deletes must stay under your own path')

  let deleted = 0
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    if (page.blobs.length > 0) {
      await del(page.blobs.map((b) => b.url))
      deleted += page.blobs.length
    }
    cursor = page.cursor
  } while (cursor)

  return json({ deleted })
}
