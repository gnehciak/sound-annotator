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
  // Every column but the notes. A library of a hundred tracks used to ship
  // every note of every one of them on each open of the home page (~2 MB for
  // the largest account), when all a tile draws is a cue per note and all a
  // folder card counts is how many. So the notes are reduced to their cues
  // here — id, start, end, colour — and the row says `cuesOnly` (rowToProject)
  // so the client fetches the real thing before opening, copying or
  // exporting it, and never writes the placeholders back. `settings` and
  // `analysis` stay: both are small and the tile reads the kind and the stems.
  const rows = (await sql`
    SELECT id, alias, owner_id, title, source, updated_at, shared,
           editable_by_link, folder_id, settings, published, published_at,
           published_by_name, analysis, deleted_at,
           CASE WHEN jsonb_typeof(annotations) = 'array' THEN (
             SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', a->'id', 'start', a->'start', 'end', a->'end', 'color', a->'color'
             ))), '[]'::jsonb)
             FROM jsonb_array_elements(annotations) a
           ) ELSE '[]'::jsonb END AS cues
    FROM projects
    WHERE owner_id = ${uid} AND (deleted_at IS NULL) = ${!trash}
    ORDER BY CASE WHEN ${trash} THEN deleted_at ELSE updated_at END DESC
  `) as ProjectRow[]
  return json(rows.map((r) => rowToProject(r)))
}
