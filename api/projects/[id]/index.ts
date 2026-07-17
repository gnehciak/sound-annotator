// GET / PUT / DELETE /api/projects/:id — the server-side authorization for a
// project, enforced here in code:
//
// - GET: shared docs (view or edit links) are fetchable by id by anyone
//   holding the link (the unguessable id is the share token); owners can
//   always fetch their own. The response carries the edit lock so the client
//   can poll it (src/lib/editLock.ts).
// - PUT: upsert. Owners may write everything except reassigning ownerId;
//   link editors (editableByLink) and guests may write content fields only.
//   Content writes must hold the edit lock while someone else's claim is live.
// - DELETE: owner only — a move to the trash, not a delete. The two ways back
//   out of it (restore, purge) live in [id]/trash.ts.
//
// Four kinds of caller reach PUT: a signed-in owner, a signed-in link editor,
// a signed-out guest holding their project's key (see _lib/guest.ts), and a
// teacher-admin (ADMIN_EMAILS, see _lib/auth.ts), who stands in as the owner of
// ANY project. Link editors and guests have identical rights — content only —
// so they share one code path.
import { getUid, getUserName, isAdmin } from '../../_lib/auth.js'
import {
  sql,
  getProjectRow,
  rowToProject,
  lockLive,
  jsonb,
  type LockValue,
} from '../../_lib/db.js'
import {
  guestKeyFrom,
  guestKeyOpens,
  hashGuestKey,
  mintGuestKey,
  newGuestOwnerId,
  takeGuestCreateSlot,
} from '../../_lib/guest.js'
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
  // A trashed project is nobody's to read but its owner's, who still needs it
  // for the trash view. Its ?view= links and its gallery card go dark the
  // moment it's trashed and light up again on restore — trashing never touches
  // `shared` or `published`, so the way back is exact.
  const trashed = row.deleted_at != null
  if (!trashed && (row.shared || row.editable_by_link || row.published))
    return json(rowToProject(row, { withLock: true }))
  const uid = await getUid(request)
  if (uid && row.owner_id === uid) return json(rowToProject(row, { withLock: true }))
  // The admin console lists every project, so an admin must be able to open one
  // that was never shared.
  if (uid && (await isAdmin(uid))) return json(rowToProject(row, { withLock: true }))
  // Trashed reads as gone, not as forbidden: to a link holder the difference
  // between "deleted" and "never existed" is nothing they can act on.
  return trashed ? err(404, 'Not found') : err(403, 'Not shared')
}

/** The claim a save carries to prove it holds the edit lock. The server
 *  stamps `at` (and the caller's real uid) — never trusted from the client. */
interface Claim {
  sessionId: string
  name?: string
}

function claimFrom(body: Record<string, unknown>, uid: string): LockValue | null {
  // `uid` is the caller's principal: a Clerk uid, or a guest project's
  // synthetic `guest:<uuid>` owner. Either way it's server-supplied.
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
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return err(400, 'Invalid JSON body')

  const existing = await getProjectRow(id)

  // Create.
  if (!existing) {
    // Guest create (`{ guest: true }`, signed out): mint the synthetic owner
    // and the key that will authorize every later write. `shared` is forced on
    // so the plain ?view= link a student hands in renders through the existing
    // read-only viewer, and the key is returned exactly once — it is never
    // stored in the clear, so a lost key cannot be recovered, only abandoned.
    if (!uid) {
      if (body.guest !== true) return err(401, 'Sign in required')
      if (!(await takeGuestCreateSlot(request)))
        return err(429, 'Too many projects created from this network. Try again later.')
      const guestKey = mintGuestKey()
      const ownerId = newGuestOwnerId()
      await sql`
        INSERT INTO projects
          (id, owner_id, title, source, annotations, updated_at, shared,
           editable_by_link, folder_id, settings, lock, guest_token_hash)
        VALUES
          (${id}, ${ownerId},
           ${typeof body.title === 'string' ? body.title : 'Untitled track'},
           ${jsonb(body.source)}::jsonb, ${jsonb(body.annotations ?? [])}::jsonb,
           ${typeof body.updatedAt === 'number' ? body.updatedAt : 0},
           ${true}, ${false}, ${null}, ${jsonb(body.settings)}::jsonb,
           ${null}, ${await hashGuestKey(guestKey)})
      `
      return json({ ok: true, guestKey, ownerId })
    }

    // The row is stamped with the caller as owner, exactly like the old
    // `create` rule (ownerId must be yours).
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
         ${jsonb(body.settings)}::jsonb, ${jsonb(claimFrom(body, uid))}::jsonb)
    `
    return json({ ok: true })
  }

  // Update. Resolve the caller to a principal: a Clerk uid, or the guest who
  // holds this row's key. Anyone else is a stranger.
  const guestKey = uid ? null : guestKeyFrom(request)
  const isGuest =
    guestKey != null && (await guestKeyOpens(guestKey, existing.guest_token_hash))
  if (!uid && !isGuest) return err(401, 'Sign in required')
  const principal = uid ?? existing.owner_id
  const stamped = claimFrom(body, principal)

  // holdsLock: a free or expired lock gates nothing; a live lock demands the
  // write carry the holder's own claim.
  const holds =
    !lockLive(existing.lock) ||
    (stamped != null && existing.lock!.sessionId === stamped.sessionId)

  // A teacher-admin stands in as the owner of any project — the console
  // manages the whole database, not just guest submissions.
  const admin = uid != null && (await isAdmin(uid))
  const isOwner = uid != null && (existing.owner_id === uid || admin)
  // A guest with the right key stands in for the link editor: same content-only
  // rights, so the clipping below covers both without a second branch.
  if (!isOwner && !isGuest && existing.editable_by_link !== true)
    return err(403, 'Not yours')
  if (!holds) return err(409, 'Another session is editing this project')
  if (
    isOwner &&
    typeof body.ownerId === 'string' &&
    body.ownerId !== existing.owner_id
  )
    return err(403, 'ownerId cannot be reassigned')

  // Merge semantics (the old `mergeFields`): only keys the payload carries
  // change; non-owners' writes are additionally clipped — never permissions,
  // ownership, or folders. `deleted_at` is absent from this whole merge on
  // purpose: only the trash routes move a row in or out of the trash, so a
  // straggling save from a tab that hasn't noticed the delete writes content
  // to a trashed row and leaves it trashed, rather than resurrecting it.
  //
  // A link editor and a guest are NOT the same, despite both being non-owners.
  // A link editor annotates someone else's track, so the source isn't theirs to
  // change. A guest's project is their own — clip the source away and they can
  // never load the video they came to annotate, which is the whole task.
  const canTouch = (k: string) =>
    isOwner ||
    (isGuest
      ? ['title', 'annotations', 'updatedAt', 'source', 'settings'].includes(k)
      : ['title', 'annotations', 'updatedAt'].includes(k))
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
  const settings =
    'settings' in body && canTouch('settings') ? body.settings : existing.settings
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
  const publishedByName =
    nowPublishing && uid ? await getUserName(uid) : existing.published_by_name

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

  // Every delete that lands here is a move to the trash. The row stays whole —
  // notes, images, share flags — so Restore is exact; api/cron/purge-trash.ts
  // hard-deletes it once the window is up. Re-deleting an already-trashed
  // project must not restart that clock, hence `deleted_at IS NULL`.
  //
  // A teacher-admin gets no shortcut here, deliberately: deleting from their
  // own library has to be the same trash it is for everyone, and since the
  // admin IS an account holder, an isAdmin() branch above this would quietly
  // opt them out of the feature. The console's permanent delete is a different
  // verb on a different route — [id]/trash.ts DELETE — so nothing turns on
  // guessing which button a request came from.
  await sql`
    UPDATE projects SET deleted_at = ${Date.now()}
    WHERE id = ${id} AND owner_id = ${uid} AND deleted_at IS NULL
  `
  return json({ ok: true })
}
