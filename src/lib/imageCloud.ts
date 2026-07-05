// Note images in Vercel Blob, one object per inserted image under the owner's
// path:  users/{uid}/images/{projectId}/{imageId}.{ext}
//
// Blob URLs are public but unguessable (the store id + the uuid path), so
// they load for the owner and for read-only `?view=` share viewers alike —
// the same trust model the old tokened download URLs had.
import { upload } from '@vercel/blob/client'
import { api } from './api'

const newId = () => crypto.randomUUID()

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const imagesPrefix = (uid: string, projectId: string) =>
  `users/${uid}/images/${projectId}/`

/**
 * Upload one note image and resolve with its public URL. `onProgress`
 * receives a 0–1 fraction as the bytes stream up. (The upload token sets
 * immutable caching — each image has a unique, immutable URL, so repeat
 * project opens serve from the browser cache instead of re-fetching.)
 */
export async function uploadNoteImage(
  uid: string,
  projectId: string,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const ext = EXT[blob.type] ?? 'jpg'
  const result = await upload(
    `${imagesPrefix(uid, projectId)}${newId()}.${ext}`,
    blob,
    {
      access: 'public',
      handleUploadUrl: '/api/blobs/upload',
      contentType: blob.type || 'image/jpeg',
      onUploadProgress: ({ percentage }) => onProgress?.(percentage / 100),
    },
  )
  return result.url
}

/**
 * Best-effort delete of every image under a project, called when the project
 * is deleted.
 */
export async function deleteProjectImages(
  uid: string,
  projectId: string,
): Promise<void> {
  await api('/api/blobs/delete', {
    method: 'POST',
    json: { prefix: imagesPrefix(uid, projectId) },
  })
}

/**
 * Garbage-collect a project's orphaned images: delete every uploaded object
 * that no longer appears in any of the project's note HTML. Matching happens
 * server-side on the blob's URL — exactly the string embedded in note HTML —
 * so a still-referenced image is always recognised and kept.
 *
 * Safe against editor undo because it reconciles against *persisted* note
 * HTML: run it on load (not mid-edit), so an image is only collected once
 * it's truly gone from the saved notes. Resolves with the number deleted.
 */
export async function reconcileProjectImages(
  _uid: string,
  projectId: string,
  noteHtml: string[],
): Promise<number> {
  const { deleted } = await api<{ deleted: number }>('/api/blobs/gc', {
    method: 'POST',
    json: { projectId, html: noteHtml },
  })
  return deleted
}
