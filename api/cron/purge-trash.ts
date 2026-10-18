// GET /api/cron/purge-trash — the daily sweep that keeps the trash a trash and
// not an attic: every project trashed longer than TRASH_TTL_MS ago is
// hard-deleted here, along with every blob it owns.
// Scheduled in vercel.json; the same teardown a manual "Delete forever" does
// from the client (App.tsx's purgeProject) — keep the two in step, since a
// prefix that only one of them knows about is a byte nobody ever collects.
//
// Guarded by CRON_SECRET, which Vercel sends as `Authorization: Bearer …` on
// its own invocations. With the var unset this route refuses to run at all,
// rather than leave an unauthenticated "delete things" endpoint on the open
// internet: set it (to any long random string) to arm the purge.
import { del, list } from '@vercel/blob'
import { sql, TRASH_TTL_MS, type ProjectRow } from '../_lib/db.js'
import { json, err } from '../_lib/respond.js'
import {
  MEDIA_CACHE_PREFIX,
  MEDIA_CACHE_TTL_MS,
  VIDEO_CACHE_PREFIX,
} from '../_lib/mediaCache.js'
import { mediaKey, stemFolder } from '../_lib/stems.js'

/** Whether any live project still points at this recording — the fence for the
 *  shared stem store's GC. */
async function stillReferenced(source: unknown): Promise<boolean> {
  const s = (source ?? {}) as { type?: string; videoId?: string; driveFileId?: string }
  if (s.type === 'youtube' && s.videoId) {
    const rows = (await sql`
      SELECT 1 FROM projects
      WHERE deleted_at IS NULL AND source->>'type' = 'youtube' AND source->>'videoId' = ${s.videoId}
      LIMIT 1
    `) as unknown[]
    return rows.length > 0
  }
  if (s.type === 'drive' && s.driveFileId) {
    const rows = (await sql`
      SELECT 1 FROM projects
      WHERE deleted_at IS NULL AND source->>'type' = 'drive' AND source->>'driveFileId' = ${s.driveFileId}
      LIMIT 1
    `) as unknown[]
    return rows.length > 0
  }
  return true // no shared key — nothing shared to collect
}

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
    SELECT id, owner_id, source FROM projects
    WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}
    LIMIT ${BATCH}
  `) as Pick<ProjectRow, 'id' | 'owner_id' | 'source'>[]

  let purged = 0
  let blobs = 0
  for (const r of rows) {
    // Blobs first, row second. A row deleted whose objects survived leaves
    // orphans nothing can ever name again; objects deleted whose row survives
    // just come back round on tomorrow's pass. So the cheap failure is the one
    // to arrange for.
    try {
      // Every prefix a project can own — note images, an uploaded PDF score,
      // the legacy audio upload, and AI section detection's separated stems +
      // analysis audio. Mirrors App.tsx's purgeProject (imageCloud.ts /
      // scoreCloud.ts / audioCloud.ts hold the paths).
      blobs += await deletePrefix(`users/${r.owner_id}/images/${r.id}/`)
      blobs += await deletePrefix(`users/${r.owner_id}/scores/${r.id}/`)
      blobs += await deletePrefix(`users/${r.owner_id}/audio/${r.id}`)
      blobs += await deletePrefix(`users/${r.owner_id}/stems/${r.id}/`)
      blobs += await deletePrefix(`users/${r.owner_id}/analysis/${r.id}`)
    } catch (e) {
      console.error(`Failed to purge blobs for ${r.id}:`, e)
      continue // leave the row; it's still expired tomorrow
    }
    // The predicate is re-checked here: if a restore landed between the scan
    // and now, the row is live again and this delete must miss it.
    await sql`DELETE FROM project_shares WHERE project_id = ${r.id}`
    await sql`
      DELETE FROM projects
      WHERE id = ${r.id} AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}
    `
    purged += 1

    // The per-recording stem store (cache/stems/<key>/) is shared by every
    // project of a video, so unlike the per-project prefixes above it can't be
    // swept with this row — it goes only when the *last* live project of the
    // recording is gone. (Paid to make, so GC'd by reference, not aged out like
    // the re-fetchable video/audio caches.) Best-effort, after the row delete.
    try {
      const key = mediaKey(r.source)
      if (key && !(await stillReferenced(r.source))) {
        blobs += await deletePrefix(stemFolder(key))
      }
    } catch (e) {
      console.error(`purge-trash: shared-stem GC failed for ${r.id}:`, e)
    }
  }

  if (rows.length === BATCH)
    console.log(`purge-trash: hit the ${BATCH} batch cap; more remain for the next run`)

  // The media caches (api/_lib/mediaCache.ts) are shared across projects, so no
  // project's purge above can touch them; they age out here instead. Each has
  // its own try: a store hiccup must not fail the trash sweep.
  const stale = Date.now() - MEDIA_CACHE_TTL_MS
  async function ageOut(prefix: string, token: string | undefined): Promise<number> {
    let gone = 0
    let cursor: string | undefined
    do {
      const page = await list({ prefix, cursor, limit: 1000, token })
      const old = page.blobs.filter((b) => b.uploadedAt.getTime() < stale).map((b) => b.url)
      if (old.length) {
        await del(old, { token })
        gone += old.length
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return gone
  }

  let cache = 0
  try {
    // The clip audio cache's own store when one is wired up, else the main one
    // (media.ts's `store()`; the same either-or, spelled out here).
    const token = process.env.BLOB_CACHE_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN
    cache += await ageOut(MEDIA_CACHE_PREFIX, token)
  } catch (e) {
    console.error('purge-trash: audio cache sweep failed:', e)
  }
  try {
    // The downloaded-video cache always lives in the main (public) store, so a
    // `<video>` can seek against its URL (media.ts's `videoStore()`).
    cache += await ageOut(VIDEO_CACHE_PREFIX, process.env.BLOB_READ_WRITE_TOKEN)
  } catch (e) {
    console.error('purge-trash: video cache sweep failed:', e)
  }
  return json({ purged, blobs, cache })
}
