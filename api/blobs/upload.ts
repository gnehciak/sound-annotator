// POST /api/blobs/upload — token handler for @vercel/blob/client uploads.
// The browser streams bytes straight to Blob storage; this endpoint only
// mints the short-lived token, pinning every upload inside the caller's own
// users/{uid}/ prefix (the port of the old storage.rules) and capping size
// at the same 60 MB.
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { getUid } from '../_lib/auth'
import { json, err } from '../_lib/respond'

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
        if (!pathname.startsWith(`users/${uid}/`))
          throw new Error('Uploads must stay under your own path')
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
