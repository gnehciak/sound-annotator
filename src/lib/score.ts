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
  ProjectScore,
  ProjectSettings,
  ScoreFit,
  ScoreMark,
  ScoreMarkKind,
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
 * note times: `slide` is that same mapping.
 *
 * Narrowing the window clamps every turn outside it onto an edge, so a group
 * of them can land on one moment — and only one can survive, or the score
 * would flip through several pages in a frame. The survivor is the **last**
 * of the group, because the page showing at a moment is the last turn at or
 * before it: clipping past pages 1–2 into page 3's music has to leave the
 * reader on page 3, not on the first page of the pile.
 */
export function shiftTurns(
  turns: ScoreTurn[] | undefined,
  slide: (t: number) => number,
): ScoreTurn[] | undefined {
  if (!turns || turns.length === 0) return turns
  const moved = sortTurns(turns.map((x) => ({ ...x, t: slide(x.t) })))
  return moved.filter(
    (x, i) => i === moved.length - 1 || moved[i + 1].t - x.t > TURN_EPSILON,
  )
}

// ---- marks ----------------------------------------------------------------
// What has been drawn on the pages. Every coordinate is a fraction of the
// drawn page (see ScoreMark), so a mark needs no arithmetic to survive a
// resize, a refit or the expand — the page box moves and the numbers don't.

/** The tools, in the order the toolbar offers them. */
export const MARK_KINDS: ScoreMarkKind[] = [
  'highlight',
  'box',
  'ellipse',
  'arrow',
  'ink',
]

/** Stroke weight when a mark doesn't say. */
export const DEFAULT_MARK_WEIGHT = 2

/**
 * The colours the toolbar offers. Drawn from the note palette so a mark and
 * the note that discusses it can be told apart at a glance — but trimmed to
 * the hues that survive being thinned to a 2px stroke on white paper.
 */
export const MARK_COLORS = [
  '#ff5252',
  '#ff9f2e',
  '#ffd633',
  '#3ddc74',
  '#5aa8ff',
  '#a06bff',
]

/** The marks drawn on one page, in the order they were made. */
export function marksOnPage(
  marks: ScoreMark[] | undefined,
  page: number,
): ScoreMark[] {
  return (marks ?? []).filter((m) => m.page === page)
}

/** Add a mark, or replace the one that shares its id. */
export function upsertMark(
  marks: ScoreMark[] | undefined,
  mark: ScoreMark,
): ScoreMark[] {
  const list = marks ?? []
  const at = list.findIndex((m) => m.id === mark.id)
  if (at === -1) return [...list, mark]
  return list.map((m, i) => (i === at ? mark : m))
}

/** Drop one mark by id. */
export function removeMark(
  marks: ScoreMark[] | undefined,
  id: string,
): ScoreMark[] {
  return (marks ?? []).filter((m) => m.id !== id)
}

/** Move a mark by a delta in page fractions, taking its stroke along. */
export function moveMark(mark: ScoreMark, dx: number, dy: number): ScoreMark {
  return {
    ...mark,
    x: mark.x + dx,
    y: mark.y + dy,
    ...(mark.points
      ? {
          points: mark.points.map((n, i) => n + (i % 2 === 0 ? dx : dy)),
        }
      : {}),
  }
}

/**
 * The mark under a point, or null — topmost first, so the thing most recently
 * drawn is the thing you select, which is what "on top" has to mean.
 *
 * Everything is hit by its box rather than its outline. An outline hit would
 * be truer for a thin arrow or an unfilled circle and much worse to use: the
 * target would be two pixels wide on a page that is already small, and a
 * near-miss would silently select nothing. `pad` widens the box by a fraction
 * of the page so a mark drawn as a thin line is still catchable.
 */
export function markAt(
  marks: ScoreMark[],
  x: number,
  y: number,
  pad = 0.008,
): ScoreMark | null {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]
    const left = Math.min(m.x, m.x + m.w) - pad
    const right = Math.max(m.x, m.x + m.w) + pad
    const top = Math.min(m.y, m.y + m.h) - pad
    const bottom = Math.max(m.y, m.y + m.h) + pad
    if (x >= left && x <= right && y >= top && y <= bottom) return m
  }
  return null
}

/**
 * The bounding box of a freehand stroke. Stored on the mark so hit-testing and
 * dragging never have to walk the points.
 */
export function inkBounds(points: number[]): {
  x: number
  y: number
  w: number
  h: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    minX = Math.min(minX, points[i])
    maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * How far apart two samples of a freehand stroke have to be to both be kept,
 * as a fraction of the page. A pointer emits a sample per frame, which on a
 * slow careful line is hundreds of points a centimetre apart — indistinguishable
 * once drawn, and all of it persisted in the project's jsonb on every save.
 */
export const INK_MIN_STEP = 0.004

// ---- zoom -----------------------------------------------------------------

/**
 * How far the reader may zoom, as a multiplier on the fitted size.
 *
 * The floor is below 1 on purpose: fit-page already shows a whole page, so the
 * only reason to go under it is to see two at once, which is exactly what you
 * want at a page turn. The ceiling is where a printed stave stops gaining
 * detail — past 5× a 150 dpi scan is just bigger, not clearer — and it also
 * bounds the canvas a phone has to hold.
 */
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 5

export function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return 1
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v))
}

/** One press of the zoom buttons — a fifth, so four presses roughly double. */
export const ZOOM_STEP = 1.2

// ---- display knobs --------------------------------------------------------
// Persisted on the score so a shared track opens the way its owner left it,
// but a reader may still change them for their own session (see useScoreView).

/** A track with a score opens on it: the score is why the score is there. */
export const DEFAULT_SCORE_MODE: ScoreMode = 'view'
export const DEFAULT_SCORE_FIT: ScoreFit = 'height'

export interface ScoreView {
  mode: ScoreMode
  /** Lay the score over the picture too, while the column is on the player. */
  overVideo: boolean
  opacity: number
  fit: ScoreFit
  /** Paint in front of note covers and pins rather than behind them. */
  onTop: boolean
}

/**
 * The view a score opens in, with every default filled in — and with the two
 * modes that predate the score view mapped onto it:
 *
 *   'score'   the score, opaque, inside the video frame  → the score view,
 *             which is that idea with room to read it;
 *   'overlay' the score dimmed over the picture          → the player view
 *             with `overVideo`, which is the same thing under its own switch.
 *
 * Done on read rather than by a migration script because the stored value is
 * a display preference in a jsonb blob: nothing breaks while a row still says
 * `'overlay'`, and it says `'off'` or `'view'` the next time it's written.
 */
export function scoreView(score?: ProjectScore): ScoreView {
  const stored = score?.mode as ScoreMode | 'score' | 'overlay' | undefined
  return {
    mode: stored === 'overlay' ? 'off' : stored === 'score' ? 'view' : stored ?? DEFAULT_SCORE_MODE,
    overVideo: stored === 'overlay' || score?.overVideo === true,
    opacity: clampOpacity(score?.opacity ?? DEFAULT_SCORE_OPACITY),
    fit: score?.fit ?? DEFAULT_SCORE_FIT,
    onTop: score?.onTop === true,
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
