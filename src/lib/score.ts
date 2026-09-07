// The PDF score attached to a track: where its bytes come from, and the
// display knobs the score layer reads. The persisted shape is ProjectScore
// (src/types.ts), which lives inside `settings` — see the note there.
//
// Two sources, and the difference is the point of the feature:
//
//  • **Drive** is a *link*. The teacher annotates the same file in Drive and
//    every reader sees the new version — no re-upload, no new link. The cost
//    is that the bytes can't come from Drive: a cross-origin request gets 403
//    (`Sec-Fetch-Site: cross-site`) and a non-Google `Referer` gets the
//    virus-scan HTML, exactly as for a Drive video, so they come through our
//    own `/api/browse?drive=…&pdf=1` proxy — our bandwidth, and only for ids a
//    live project points at. See lib/drive.ts for the full reasoning.
//  • **Blob** is bytes we host, uploaded by a signed-in owner. Fixed at upload
//    time; changing it means uploading again.
//
// Guests can link a Drive score but never upload one — their Blob token is
// images-only by design (api/blobs/upload.ts).
import type { Project, ProjectScore, ProjectSettings, ScoreFit, ScoreMode } from '../types'
import { driveViewUrl, looksLikeDriveLink, parseDriveFileId } from './drive'

/**
 * Ceiling for an uploaded score, matched by the upload token server-side. A
 * typeset score runs 1–5 MB; a phone-photographed one can be far bigger, and
 * a PDF this size is already past what a classroom connection wants to pull.
 */
export const MAX_SCORE_BYTES = 30 * 1024 * 1024

/** Default overlay opacity — readable, but the picture still shows through. */
export const DEFAULT_SCORE_OPACITY = 0.85

/** The track's score, or undefined when it has none. */
export function scoreOf(p?: Pick<Project, 'settings'> | null): ProjectScore | undefined {
  return p?.settings?.score
}

/** Whether a score is complete enough to load (a half-written one isn't). */
export function scoreIsLoadable(score?: ProjectScore): boolean {
  if (!score) return false
  return score.kind === 'drive' ? Boolean(score.driveFileId) : Boolean(score.url)
}

/**
 * Where the score's bytes are fetched from. `bust` changes the URL — and so
 * the CDN cache key — which is how "Reload score" beats both the edge cache
 * and the browser's after the teacher updates the file in Drive.
 */
export function scoreBytesUrl(score: ProjectScore, bust = 0): string | null {
  if (score.kind === 'drive') {
    if (!score.driveFileId) return null
    const v = bust ? `&v=${bust}` : ''
    return `/api/browse?drive=${encodeURIComponent(score.driveFileId)}&pdf=1${v}`
  }
  return score.url ?? null
}

/** The human-facing page for the score — "open the original", Drive only. */
export function scoreLinkUrl(score: ProjectScore): string | null {
  if (score.kind !== 'drive') return null
  return score.driveUrl ?? (score.driveFileId ? driveViewUrl(score.driveFileId) : null)
}

/** What the score menu calls this score. */
export function scoreLabel(score: ProjectScore): string {
  if (score.kind === 'drive') return 'Drive PDF'
  return score.fileName || 'Uploaded PDF'
}

/**
 * Read a pasted link as a Drive score. Returns an error message rather than
 * null so the form can say which way the paste went wrong — a folder link and
 * a YouTube link fail for different reasons and deserve different words.
 */
export function scoreFromLink(
  input: string,
): { score: ProjectScore } | { error: string } {
  const url = input.trim()
  if (!url) return { error: 'Paste a Google Drive link to the PDF.' }
  const fileId = parseDriveFileId(url)
  if (fileId) return { score: { kind: 'drive', driveFileId: fileId, driveUrl: url } }
  return {
    error: looksLikeDriveLink(url)
      ? "That's a Drive link, but not to a file — open the PDF itself and copy its link."
      : 'That doesn’t look like a Google Drive link.',
  }
}

// ---- display knobs --------------------------------------------------------
// Persisted on the score so a shared track opens the way its owner left it,
// but a reader may still change them for their own session (see useScoreView).

export const DEFAULT_SCORE_MODE: ScoreMode = 'score'
export const DEFAULT_SCORE_FIT: ScoreFit = 'height'

export interface ScoreView {
  mode: ScoreMode
  opacity: number
  fit: ScoreFit
}

/** The view a score opens in, with every default filled in. */
export function scoreView(score?: ProjectScore): ScoreView {
  return {
    mode: score?.mode ?? DEFAULT_SCORE_MODE,
    opacity: clampOpacity(score?.opacity ?? DEFAULT_SCORE_OPACITY),
    fit: score?.fit ?? DEFAULT_SCORE_FIT,
  }
}

export function clampOpacity(v: number): number {
  return Math.min(1, Math.max(0.2, v))
}

/** Settings with the score patched (or removed, for a null patch). */
export function withScore(
  settings: ProjectSettings | undefined,
  score: ProjectScore | null,
): ProjectSettings {
  const next: ProjectSettings = { ...settings }
  if (score) next.score = score
  else delete next.score
  return next
}
