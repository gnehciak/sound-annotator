// Note images in Cloud Storage, one object per inserted image under the owner's
// path:  users/{uid}/images/{projectId}/{imageId}.{ext}
//
// The returned download URL carries its own access token, so it loads for the
// owner and for read-only `?view=` share viewers alike — without widening
// storage.rules (which already grants the owner read/write on users/{uid}/**).
import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  uploadBytesResumable,
} from 'firebase/storage'
import { storage } from './firebase'

const newId = () => crypto.randomUUID()

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const imagesDir = (uid: string, projectId: string) =>
  ref(storage, `users/${uid}/images/${projectId}`)

/**
 * Upload one note image and resolve with its public download URL. `onProgress`
 * receives a 0–1 fraction as the bytes stream up.
 */
export function uploadNoteImage(
  uid: string,
  projectId: string,
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const ext = EXT[blob.type] ?? 'jpg'
  const objectRef = ref(
    storage,
    `users/${uid}/images/${projectId}/${newId()}.${ext}`,
  )
  const task = uploadBytesResumable(objectRef, blob, {
    contentType: blob.type || 'image/jpeg',
    // Each image has a unique, immutable URL, so let the browser cache it
    // forever — repeat project opens then serve from cache instead of re-fetching.
    cacheControl: 'public, max-age=31536000, immutable',
  })
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) =>
        onProgress?.(
          snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0,
        ),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject),
    )
  })
}

/**
 * Best-effort delete of every image under a project, called when the project is
 * deleted.
 */
export async function deleteProjectImages(
  uid: string,
  projectId: string,
): Promise<void> {
  const listing = await listAll(imagesDir(uid, projectId))
  await Promise.all(
    listing.items.map((item) => deleteObject(item).catch(() => {})),
  )
}

/**
 * Garbage-collect a project's orphaned images: delete every uploaded object that
 * no longer appears in any of the project's note HTML. Matching is on the
 * object's URL-encoded full path — exactly the segment Firebase embeds in its
 * download URLs — so a still-referenced image is always recognised and kept.
 *
 * Safe against editor undo because it reconciles against *persisted* note HTML:
 * run it on load (not mid-edit), so an image is only collected once it's truly
 * gone from the saved notes. Resolves with the number of objects deleted.
 */
export async function reconcileProjectImages(
  uid: string,
  projectId: string,
  noteHtml: string[],
): Promise<number> {
  const listing = await listAll(imagesDir(uid, projectId))
  if (listing.items.length === 0) return 0
  const haystack = noteHtml.join('\n')
  const orphans = listing.items.filter(
    (item) => !haystack.includes(encodeURIComponent(item.fullPath)),
  )
  await Promise.all(orphans.map((item) => deleteObject(item).catch(() => {})))
  return orphans.length
}
