// An uploaded PDF score in Vercel Blob, one object per project under the
// owner's path:  users/{uid}/scores/{projectId}/{scoreId}.pdf
//
// Same shape as note images (imageCloud.ts) and for the same reason: the
// per-project teardown sweeps are written against `users/{owner}/…/{project}/`
// prefixes, so a score added here is collected for free by the purge cron and
// the admin console — as long as the `scores/` prefix is listed in both. It is
// (api/cron/purge-trash.ts and App's purgeProject); a prefix only one of them
// knows about is bytes nobody ever collects.
//
// Uploads are signed-in only. A guest has no account to own the bytes and
// their upload token is images-only by design, so their path to a score is a
// Drive link (see lib/score.ts).
import { upload } from '@vercel/blob/client'
import { api } from './api'
import { MAX_SCORE_BYTES } from './score'
import { newId } from './ids'

const scoresPrefix = (uid: string, projectId: string) =>
  `users/${uid}/scores/${projectId}/`

/**
 * Upload one PDF score and resolve with its public URL. `onProgress` receives
 * a 0–1 fraction as the bytes stream up. Rejects with a user-facing message
 * when the file isn't a PDF or is over the ceiling — the upload token enforces
 * both server-side too, but failing here costs no round trip.
 */
export async function uploadScorePdf(
  uid: string,
  projectId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name))
    throw new Error('A score has to be a PDF.')
  if (file.size > MAX_SCORE_BYTES)
    throw new Error(
      `That PDF is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ${Math.round(
        MAX_SCORE_BYTES / 1024 / 1024,
      )} MB.`,
    )

  const result = await upload(
    `${scoresPrefix(uid, projectId)}${newId()}.pdf`,
    file,
    {
      access: 'public',
      handleUploadUrl: '/api/blobs/upload',
      contentType: 'application/pdf',
      onUploadProgress: ({ percentage }) => onProgress?.(percentage / 100),
    },
  )
  return result.url
}

/**
 * Best-effort delete of every score a project owns — the project teardown.
 * Mirrored server-side by the purge cron (api/cron/purge-trash.ts).
 */
export async function deleteProjectScores(
  uid: string,
  projectId: string,
): Promise<void> {
  await api('/api/blobs/delete', {
    method: 'POST',
    json: { prefix: scoresPrefix(uid, projectId) },
  })
}

/**
 * Delete one uploaded score by its public URL — what a *replace* needs.
 * Sweeping the whole `scores/{projectId}/` prefix would be wrong there: the
 * replacement already lives in that same folder, so the sweep would take it
 * too. A blob's pathname is a unique prefix of exactly itself, which the
 * delete endpoint's prefix matching turns into a single-object delete.
 */
export async function deleteScoreBlob(url: string): Promise<void> {
  let pathname: string
  try {
    // Percent-encoded on the way out (a guest owner id carries a colon);
    // the stored pathname is the decoded form.
    pathname = decodeURIComponent(new URL(url).pathname).replace(/^\//, '')
  } catch {
    return
  }
  if (!pathname.startsWith('users/')) return
  await api('/api/blobs/delete', { method: 'POST', json: { prefix: pathname } })
}
