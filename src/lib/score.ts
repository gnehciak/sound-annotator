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
import type {
  Project,
  ProjectScore,
  ProjectSettings,
  ScoreFit,
  ScoreMode,
  ScoreTurn,
} from '../types'
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


// ---- page turns -----------------------------------------------------------
// The list is kept sorted by time and holds one entry per *turn*, never one
// per page: a repeat brings a page back later, and a page nobody turns away
// from needs no second entry.

/**
 * How far ahead of the press a stamped turn is placed, in seconds. You press
 * after you register the moment, never before it, so every stamp of a live
 * pass lands late by roughly the same amount — one constant subtracted at
 * stamp time is what makes a recorded sync feel right instead of a beat
 * behind. Adjustable in the sync panel; this is the starting guess.
 */
export const DEFAULT_TURN_LEAD = 0.3

/** The page showing at clip time `t` — the last turn at or before it. */
export function pageAt(turns: ScoreTurn[] | undefined, t: number): number | null {
  if (!turns || turns.length === 0) return null
  // Binary search for the rightmost turn with turn.t <= t.
  let lo = 0
  let hi = turns.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (turns[mid].t <= t) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  // Before the first turn the score sits on the page that turn leaves from,
  // which is the page before it — a first turn to page 2 at 0:45 means page 1
  // is what you read until then.
  return found === -1 ? Math.max(1, turns[0].page - 1) : turns[found].page
}

/** Turns in time order — the shape every reader assumes. */
export function sortTurns(turns: ScoreTurn[]): ScoreTurn[] {
  return [...turns].sort((a, b) => a.t - b.t || a.page - b.page)
}

/**
 * Add a turn to `page` at time `t`, replacing any turn already within
 * `EPSILON` of it. Stamping twice at the same moment is a correction, not two
 * turns a hair apart that no reader could tell from one.
 */
export function addTurn(
  turns: ScoreTurn[] | undefined,
  t: number,
  page: number,
): ScoreTurn[] {
  const at = Math.max(0, t)
  const kept = (turns ?? []).filter((x) => Math.abs(x.t - at) > TURN_EPSILON)
  return sortTurns([...kept, { t: at, page }])
}

/** Two turns closer than this are the same turn — see addTurn. */
export const TURN_EPSILON = 0.25

/** Drop the turn at `index`. */
export function removeTurn(turns: ScoreTurn[], index: number): ScoreTurn[] {
  return turns.filter((_, i) => i !== index)
}

/** Move one turn by `by` seconds, keeping the list sorted and non-negative. */
export function nudgeTurn(turns: ScoreTurn[], index: number, by: number): ScoreTurn[] {
  return sortTurns(
    turns.map((x, i) => (i === index ? { ...x, t: Math.max(0, x.t + by) } : x)),
  )
}

/**
 * Re-anchor turns to a moved clip window, exactly as App's setClip does to
 * note times: `slide` is that same mapping. A turn pushed onto the window's
 * start is dropped rather than kept, since a pile of turns all at 0 would
 * flip the score through several pages in one frame.
 */
export function shiftTurns(
  turns: ScoreTurn[] | undefined,
  slide: (t: number) => number,
): ScoreTurn[] | undefined {
  if (!turns || turns.length === 0) return turns
  const moved = sortTurns(turns.map((x) => ({ ...x, t: slide(x.t) })))
  return moved.filter((x, i) => i === 0 || x.t - moved[i - 1].t > TURN_EPSILON)
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
