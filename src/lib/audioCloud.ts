// Legacy audio blobs in Vercel Blob, one object per project under the owner's
// path: users/{uid}/audio/{projectId}
//
// A track's *listening* audio is never uploaded any more — it's a link the
// user pastes (see components/AudioUrlForm); deleteAudioCloud remains so that
// deleting a project still cleans up blobs uploaded back when it did. The one
// upload left is the ephemeral users/{uid}/analysis/{projectId} object AI
// section detection runs against (deleted server-side at finalize).
import { upload } from '@vercel/blob/client'
import { api } from './api'

const audioPath = (uid: string, projectId: string) =>
  `users/${uid}/audio/${projectId}`

export async function deleteAudioCloud(
  uid: string,
  projectId: string,
): Promise<void> {
  // Prefix delete; nothing under it (a project that never had an upload) is
  // not an error.
  await api('/api/blobs/delete', {
    method: 'POST',
    json: { prefix: audioPath(uid, projectId) },
  })
}

// The temporary audio a YouTube project's section detection runs against —
// one object, deleted server-side once the analysis finalizes.
const analysisPath = (uid: string, projectId: string) =>
  `users/${uid}/analysis/${projectId}`

/** Upload the analysis audio for a YouTube project (client-streamed via the
 *  /api/blobs/upload token handler) and resolve with its URL. */
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
