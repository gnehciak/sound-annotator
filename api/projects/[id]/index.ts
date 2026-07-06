// GET / PUT / DELETE /api/projects/:id — the server-side authorization for a
// project, enforced here in code:
//
// - GET: shared docs (view or edit links) are fetchable by id by anyone
//   holding the link (the unguessable id is the share token); owners can
//   always fetch their own. The response carries the edit lock so the client
//   can poll it (src/lib/editLock.ts).
// - PUT: upsert. Owners may write everything except reassigning ownerId;
//   link editors (editableByLink) may write content fields only. Content
//   writes must hold the edit lock while someone else's claim is live.
// - DELETE: owner only.
import { getUid, getUserName } from '../../_lib/auth.js'
import {
  sql,
  getProjectRow,
  rowToProject,
  lockLive,
  jsonb,
  type LockValue,
} from '../../_lib/db.js'
import { json, err } from '../../_lib/respond.js'

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>
}

export async function GET(request: Request): Promise<Response> {
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const row = await getProjectRow(id)
  // 404 (vs 403) tells the edit-lock poller "doc not created yet" — a
  // brand-new project has no row until its first save. Ids are unguessable,
  // so existence probing gains nothing.
  if (!row) return err(404, 'Not found')
  if (row.shared || row.editable_by_link || row.published)
    return json(rowToProject(row, { withLock: true }))
  const uid = await getUid(request)
  if (uid && row.owner_id === uid) return json(rowToProject(row, { withLock: true }))
  return err(403, 'Not shared')
}

/** The claim a save carries to prove it holds the edit lock. The server
 *  stamps `at` (and the caller's real uid) — never trusted from the client. */
interface Claim {
  sessionId: string
  name?: string
}

function claimFrom(body: Record<string, unknown>, uid: string): LockValue | null {
  const c = body.lock as Claim | null | undefined
  if (!c || typeof c.sessionId !== 'string') return null
  return {
    sessionId: c.sessionId,
    uid,
    name: typeof c.name === 'string' ? c.name : 'Someone',
    at: Date.now(),
  }
}

export async function PUT(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return err(400, 'Invalid JSON body')
  const stamped = claimFrom(body, uid)

  const existing = await getProjectRow(id)

  // Create: the row is stamped with the caller as owner, exactly like the old
  // `create` rule (ownerId must be yours).
  if (!existing) {
    if (typeof body.ownerId === 'string' && body.ownerId !== uid)
      return err(403, 'ownerId must be your own')
    await sql`
      INSERT INTO projects
        (id, owner_id, title, source, annotations, updated_at, shared,
         editable_by_link, folder_id, settings, lock)
      VALUES
        (${id}, ${uid}, ${typeof body.title === 'string' ? body.title : 'Untitled track'},
         ${jsonb(body.source)}::jsonb, ${jsonb(body.annotations ?? [])}::jsonb,
         ${typeof body.updatedAt === 'number' ? body.updatedAt : 0},
         ${body.shared === true}, ${body.editableByLink === true},
         ${typeof body.folderId === 'string' ? body.folderId : null},
         ${jsonb(body.settings)}::jsonb, ${jsonb(stamped)}::jsonb)
    `
    return json({ ok: true })
  }

  // holdsLock: a free or expired lock gates nothing; a live lock demands the
  // write carry the holder's own claim.
  const holds =
    !lockLive(existing.lock) ||
    (stamped != null && existing.lock!.sessionId === stamped.sessionId)

  const isOwner = existing.owner_id === uid
  if (!isOwner && existing.editable_by_link !== true) return err(403, 'Not yours')
  if (!holds) return err(409, 'Another session is editing this project')
  if (isOwner && typeof body.ownerId === 'string' && body.ownerId !== uid)
    return err(403, 'ownerId cannot be reassigned')

  // Merge semantics (the old `mergeFields`): only keys the payload carries
  // change; link editors' writes are additionally clipped to content fields —
  // never permissions, ownership, the source, or folders.
  const canTouch = (k: string) =>
    isOwner || ['title', 'annotations', 'updatedAt'].includes(k)
  const pick = <T>(k: string, ok: (v: unknown) => boolean, fallback: T): T =>
    k in body && canTouch(k) && ok(body[k]) ? (body[k] as T) : fallback

  const title = pick('title', (v) => typeof v === 'string', existing.title)
  const source = 'source' in body && canTouch('source') ? body.source : existing.source
  const annotations =
    'annotations' in body && canTouch('annotations') ? body.annotations : existing.annotations
  const updatedAt = pick('updatedAt', (v) => typeof v === 'number', Number(existing.updated_at) || 0)
  const shared = 'shared' in body && isOwner ? body.shared === true : existing.shared
  const editableByLink =
    'editableByLink' in body && isOwner ? body.editableByLink === true : existing.editable_by_link
  const folderId =
    'folderId' in body && isOwner
      ? typeof body.folderId === 'string'
        ? body.folderId
        : null
      : existing.folder_id
  const settings = 'settings' in body && isOwner ? body.settings : existing.settings
  // A save carrying a claim refreshes the lock (that's what keeps the holder's
  // heartbeat warm on every save); one without a claim leaves it untouched.
  const lock = stamped ?? existing.lock

  // Publishing (owner only). Flipping on stamps the byline + timestamp — the
  // Clerk lookup runs only on that transition, not on every save. Flipping
  // off delists immediately; the stale byline is harmless and invisible.
  const published =
    'published' in body && isOwner ? body.published === true : existing.published
  const nowPublishing = published && existing.published !== true
  const publishedAt = nowPublishing ? Date.now() : existing.published_at
  const publishedByName = nowPublishing
    ? await getUserName(uid)
    : existing.published_by_name

  await sql`
    UPDATE projects SET
      title = ${title},
      source = ${jsonb(source)}::jsonb,
      annotations = ${jsonb(annotations ?? [])}::jsonb,
      updated_at = ${updatedAt},
      shared = ${shared},
      editable_by_link = ${editableByLink},
      folder_id = ${folderId},
      settings = ${jsonb(settings)}::jsonb,
      lock = ${jsonb(lock)}::jsonb,
      published = ${published},
      published_at = ${publishedAt},
      published_by_name = ${publishedByName}
    WHERE id = ${id}
  `
  return json({ ok: true })
}

export async function DELETE(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  await sql`DELETE FROM projects WHERE id = ${id} AND owner_id = ${uid}`
  return json({ ok: true })
}
