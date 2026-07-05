// Audio blobs in Vercel Blob, one object per project under the owner's path:
//   users/{uid}/audio/{projectId}
// The browser streams bytes straight to Blob storage; /api/blobs/upload only
// mints the token (and pins the path to the caller's own prefix).
import { upload } from '@vercel/blob/client'
import { api } from './api'

const audioPath = (uid: string, projectId: string) =>
  `users/${uid}/audio/${projectId}`

/**
 * Upload an audio file and resolve with its public URL. `onProgress` receives
 * a 0–1 fraction as the upload streams.
 */
export async function uploadAudio(
  uid: string,
  projectId: string,
  file: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const blob = await upload(audioPath(uid, projectId), file, {
    access: 'public',
    handleUploadUrl: '/api/blobs/upload',
    contentType: (file as File).type || 'audio/mpeg',
    // Large files upload in parts — smoother progress and resilient retries.
    multipart: true,
    onUploadProgress: ({ percentage }) => onProgress?.(percentage / 100),
  })
  return blob.url
}

export async function deleteAudioCloud(
  uid: string,
  projectId: string,
): Promise<void> {
  // Prefix delete; nothing under it (project never had audio) is not an error.
  await api('/api/blobs/delete', {
    method: 'POST',
    json: { prefix: audioPath(uid, projectId) },
  })
}
