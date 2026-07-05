// POST /api/blobs/gc — garbage-collect a project's orphaned note images:
// delete every uploaded image whose URL no longer appears in the project's
// persisted note HTML. Safe against editor undo because the client calls it
// on load (not mid-edit) with the *saved* HTML — an image is only collected
// once it's truly gone from the notes.
import { del, list } from '@vercel/blob'
import { getUid } from '../_lib/auth.js'
import { json, err } from '../_lib/respond.js'

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')

  const body = (await request.json().catch(() => null)) as {
    projectId?: string
    html?: string[]
  } | null
  if (!body?.projectId || !Array.isArray(body.html))
    return err(400, 'Missing projectId or html')

  const haystack = body.html.join('\n')
  const prefix = `users/${uid}/images/${body.projectId}/`

  let deleted = 0
  let cursor: string | undefined
  do {
    const page = await list({ prefix, cursor, limit: 1000 })
    // Match on the blob's URL — exactly the string embedded in note HTML
    // (TipTap entity-escapes &, but blob URLs carry no query string).
    const orphans = page.blobs.filter((b) => !haystack.includes(b.url))
    if (orphans.length > 0) {
      await del(orphans.map((b) => b.url))
      deleted += orphans.length
    }
    cursor = page.cursor
  } while (cursor)

  return json({ deleted })
}
