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

// The temporary audio a YouTube project's section detection runs against —
// one object, deleted server-side once the analysis finalizes.
const analysisPath = (uid: string, projectId: string) =>
  `users/${uid}/analysis/${projectId}`

/** Upload the analysis audio for a YouTube project (same client-streamed
 *  path as uploadAudio, different prefix) and resolve with its URL. */
export async function uploadAnalysisAudio(
  uid: string,
  projectId: string,
  file: File | Blob,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const blob = await upload(analysisPath(uid, projectId), file, {
    access: 'public',
    handleUploadUrl: '/api/blobs/upload',
    contentType: (file as File).type || 'audio/mpeg',
    multipart: true,
    onUploadProgress: ({ percentage }) => onProgress?.(percentage / 100),
  })
  return blob.url
}

/** Sweep a deleted project's analysis artifacts: the saved stems, and any
 *  temporary analysis upload a crashed run left behind. */
export async function deleteAnalysisArtifacts(
  uid: string,
  projectId: string,
): Promise<void> {
  await Promise.all([
    api('/api/blobs/delete', {
      method: 'POST',
      json: { prefix: `users/${uid}/stems/${projectId}/` },
    }),
    api('/api/blobs/delete', {
      method: 'POST',
      json: { prefix: analysisPath(uid, projectId) },
    }),
  ])
}
