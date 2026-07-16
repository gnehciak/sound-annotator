// Legacy audio blobs in Vercel Blob, one object per project under the owner's
// path: users/{uid}/audio/{projectId}
//
// Nothing uploads audio any more — a track's audio is a link the user pastes
// (see components/AudioUrlForm), which is why there's no upload here. This
// remains so that deleting a project still cleans up the blobs uploaded back
// when it did, and it can go once none are left.
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
