// POST /api/blobs/upload — token handler for @vercel/blob/client uploads.
// The browser streams bytes straight to Blob storage; this endpoint only
// mints the short-lived token, pinning every upload inside the caller's own
// users/{uid}/images/ prefix (the port of the old storage.rules) and capping
// size at 60 MB.
//
// Two things upload now: note images, and the ephemeral analysis audio AI
// section detection runs against (users/{uid}/analysis/{projectId} — deleted
// server-side once the analysis finalizes; see api/projects/[id]/analyze.ts).
// A track's *listening* audio is a link the user pastes, not bytes we host
// (see src/components/AudioUrlForm) — the legacy users/{uid}/audio/ objects
// are still served and still deleted, just never written.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getUid } from '../_lib/auth.js'
import { json, err } from '../_lib/respond.js'

export async function POST(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')

  const body = (await request.json().catch(() => null)) as HandleUploadBody | null
  if (!body) return err(400, 'Invalid body')

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
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
          // Each image URL is immutable — let browsers cache it forever.
          cacheControlMaxAge: pathname.includes('/images/') ? 31536000 : undefined,
        }
      },
      // Nothing to reconcile server-side: the client stores the returned URL
      // on the project itself.
      onUploadCompleted: async () => {},
    })
    return json(result)
  } catch (e) {
    return err(400, e instanceof Error ? e.message : 'Upload rejected')
  }
}
