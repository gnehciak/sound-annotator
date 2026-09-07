// POST /api/blobs/upload — token handler for @vercel/blob/client uploads.
// The browser streams bytes straight to Blob storage; this endpoint only
// mints the short-lived token, pinning every upload inside the caller's own
// users/{owner}/ prefix and capping its size.
//
// Two kinds of caller reach this route, and they are authorized differently:
//
//   • a signed-in teacher, resolved from their session cookie, who may write
//     note images and the ephemeral analysis audio AI section detection runs
//     against (users/{uid}/analysis/{projectId} — deleted server-side once the
//     analysis finalizes; see api/projects/[id]/analyze.ts);
//   • a guest student, who has no account and instead proves possession of one
//     project's capability key. Their token is deliberately narrower: images
//     only, into that one project's folder, smaller, and non-overwriting.
//
// A guest's key can't ride in a header — @vercel/blob/client requests its
// token with its own fetch and carries no custom headers (which is why the
// signed-in half rides the same-origin session cookie instead). So the key
// arrives in `clientPayload`, the one channel the SDK does hand through, and
// is verified here against the row's stored hash exactly as
// api/projects/[id] does it.
//
// A track's *listening* audio is a link the user pastes, not bytes we host
// (see src/components/AudioUrlForm) — the legacy users/{uid}/audio/ objects
// are still served and still deleted, just never written.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getUid } from '../_lib/auth.js'
import { getProjectRow } from '../_lib/db.js'
import { guestKeyOpens, isGuestOwner } from '../_lib/guest.js'
import { json, err } from '../_lib/respond.js'

/** A year: every image URL is unique and immutable, so cache it forever. */
const IMAGE_CACHE_SECONDS = 31536000

/**
 * Guests get a much smaller ceiling than the 60 MB a signed-in upload may use.
 * Nothing legitimate comes near it: the client downscales to 1280px and
 * re-encodes before uploading (src/lib/image.ts), which lands a phone photo
 * well under 1 MB. The cap is here for what an unauthenticated caller could do
 * on purpose, not for what a student will do by accident.
 */
const GUEST_MAX_BYTES = 8 * 1024 * 1024

/** Guests may only send actual images — no arbitrary payloads. */
const GUEST_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null
  if (!body) return err(400, 'Invalid body')

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) =>
        uid ? signedInToken(uid, pathname) : guestToken(pathname, clientPayload),
      // Nothing to reconcile server-side: the client stores the returned URL
      // on the project itself.
      onUploadCompleted: async () => {},
    })
    return json(result)
  } catch (e) {
    return err(400, e instanceof Error ? e.message : 'Upload rejected')
  }
}

/** The teacher's token: their whole images/ and analysis/ space. */
function signedInToken(uid: string, pathname: string) {
  if (
    !pathname.startsWith(`users/${uid}/images/`) &&
    !pathname.startsWith(`users/${uid}/analysis/`)
  )
    throw new Error(
      'Only note images and analysis audio can be uploaded, under your own path',
    )
  return {
    // Paths are already unique (audio: one object per project; images:
    // a fresh uuid per upload) — keep them stable so audio re-uploads
    // replace in place and note HTML can reference URLs forever.
    addRandomSuffix: false,
    allowOverwrite: true,
    maximumSizeInBytes: 60 * 1024 * 1024,
    cacheControlMaxAge: pathname.includes('/images/')
      ? IMAGE_CACHE_SECONDS
      : undefined,
  }
}

/**
 * The guest's token: one project's images/ folder, and only if they hold that
 * project's key.
 *
 * Note the path this returns is built from the *row's* owner id, never from
 * anything the client said — so the pathname the caller asked for is checked
 * against the folder their key actually opens. `guest:<uuid>` owner ids keep
 * working as a Blob prefix (the colon is legal in a pathname and percent-
 * encodes to %3A in the public URL), which is what lets a guest's images be
 * torn down by the same `users/{owner_id}/images/{id}/` sweep every other
 * project already gets — in api/cron/purge-trash.ts and in the admin console.
 */
async function guestToken(pathname: string, clientPayload: string | null) {
  const payload = parsePayload(clientPayload)
  const projectId = typeof payload?.projectId === 'string' ? payload.projectId : null
  const guestKey = typeof payload?.guestKey === 'string' ? payload.guestKey : null
  if (!projectId || !guestKey) throw new Error('Sign in required')

  const row = await getProjectRow(projectId)
  // Same answer for "no such project", "not a guest project" and "wrong key":
  // this endpoint must not become an oracle for which project ids exist.
  if (!row || row.deleted_at || !isGuestOwner(row.owner_id))
    throw new Error('Upload not allowed')
  if (!(await guestKeyOpens(guestKey, row.guest_token_hash)))
    throw new Error('Upload not allowed')

  // Built from the row's own key, not the id the client sent — that may be the
  // short alias, while the path the browser built uses the project's real id.
  if (!pathname.startsWith(`users/${row.owner_id}/images/${row.id}/`))
    throw new Error('Uploads must stay inside this project')

  return {
    allowedContentTypes: GUEST_CONTENT_TYPES,
    addRandomSuffix: false,
    // Unlike the signed-in path, refuse overwrites. Every image already gets a
    // fresh uuid, so nothing legitimate needs it — and without it a leaked link
    // could be used to replace images already in the student's notes.
    allowOverwrite: false,
    maximumSizeInBytes: GUEST_MAX_BYTES,
    cacheControlMaxAge: IMAGE_CACHE_SECONDS,
  }
}

/** Parse the SDK's `clientPayload`, treating any malformed value as absent. */
function parsePayload(
  raw: string | null,
): { projectId?: unknown; guestKey?: unknown } | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as { projectId?: unknown; guestKey?: unknown }
  } catch {
    return null
  }
}
