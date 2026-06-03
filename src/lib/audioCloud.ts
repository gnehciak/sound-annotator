// Audio blobs in Cloud Storage, one object per project under the owner's path:
//   users/{uid}/audio/{projectId}
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from 'firebase/storage'
import { storage } from './firebase'

const audioRef = (uid: string, projectId: string) =>
  ref(storage, `users/${uid}/audio/${projectId}`)

/**
 * Upload an audio file and resolve with its download URL. `onProgress` receives
 * a 0–1 fraction as the upload streams.
 */
export function uploadAudio(
  uid: string,
  projectId: string,
  file: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const task = uploadBytesResumable(audioRef(uid, projectId), file, {
    contentType: (file as File).type || 'audio/mpeg',
  })
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => onProgress?.(snap.bytesTransferred / snap.totalBytes || 0),
      reject,
      () => getDownloadURL(task.snapshot.ref).then(resolve, reject),
    )
  })
}

export async function deleteAudioCloud(
  uid: string,
  projectId: string,
): Promise<void> {
  try {
    await deleteObject(audioRef(uid, projectId))
  } catch (err) {
    // Nothing to delete (e.g. project never had audio) — not an error.
    if ((err as { code?: string }).code !== 'storage/object-not-found') throw err
  }
}
