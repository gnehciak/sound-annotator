// GET /api/cron/purge-trash — the daily sweep that keeps the trash a trash and
// not an attic: every project trashed longer than TRASH_TTL_MS ago is
// hard-deleted here, along with its note images and any legacy audio blob.
// Scheduled in vercel.json; the same teardown a manual "Delete forever" does
// from the client (App.tsx's purgeProject).
//
// Guarded by CRON_SECRET, which Vercel sends as `Authorization: Bearer …` on
// its own invocations. With the var unset this route refuses to run at all,
// rather than leave an unauthenticated "delete things" endpoint on the open
// internet: set it (to any long random string) to arm the purge.
import { del, list } from '@vercel/blob'
import { sql, TRASH_TTL_MS, type ProjectRow } from '../_lib/db.js'
import { json, err } from '../_lib/respond.js'

/** Delete every blob under a prefix; resolves with how many went. */
async function deletePrefix(prefix: string): Promise<number> {
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
  return deleted
}

// A bounded run: whatever this pass doesn't reach is still expired tomorrow,
// and a runaway batch can't hold the function open past its timeout.
const BATCH = 200

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  if (!secret) return err(503, 'CRON_SECRET is not configured')
  if (request.headers.get('authorization') !== `Bearer ${secret}`)
    return err(401, 'Unauthorized')

  const cutoff = Date.now() - TRASH_TTL_MS
  const rows = (await sql`
    SELECT id, owner_id FROM projects
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
    LIMIT ${BATCH}
  `) as Pick<ProjectRow, 'id' | 'owner_id'>[]

  let purged = 0
  let blobs = 0
  for (const r of rows) {
    // Blobs first, row second. A row deleted whose objects survived leaves
    // orphans nothing can ever name again; objects deleted whose row survives
    // just come back round on tomorrow's pass. So the cheap failure is the one
    // to arrange for.
    try {
      blobs += await deletePrefix(`users/${r.owner_id}/images/${r.id}/`)
      blobs += await deletePrefix(`users/${r.owner_id}/audio/${r.id}`)
    } catch (e) {
      console.error(`Failed to purge blobs for ${r.id}:`, e)
      continue // leave the row; it's still expired tomorrow
    }
    // The predicate is re-checked here: if a restore landed between the scan
    // and now, the row is live again and this delete must miss it.
    await sql`
      DELETE FROM projects
      WHERE id = ${r.id} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}
    `
    purged += 1
  }

  if (rows.length === BATCH)
    console.log(`purge-trash: hit the ${BATCH} batch cap; more remain for the next run`)
  return json({ purged, blobs })
}
