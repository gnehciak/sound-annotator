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
import { newId } from './ids'

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
  'text',
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
  return upsertMarks(marks, [mark])
}

/**
 * Add or replace several at once — one write, so a gesture over a selection
 * (a move, a restyle, a nudge) is one save and one undo step, not one each.
 * A replaced mark keeps its place in the list, which is its place in z-order.
 */
export function upsertMarks(
  marks: ScoreMark[] | undefined,
  next: ScoreMark[],
): ScoreMark[] {
  const byId = new Map(next.map((m) => [m.id, m]))
  const list = (marks ?? []).map((m) => byId.get(m.id) ?? m)
  const known = new Set(list.map((m) => m.id))
  return [...list, ...next.filter((m) => !known.has(m.id))]
}

/**
 * Order **is** z-order: later in the list is nearer the reader, which is why a
 * new mark is appended and why `markAt` walks backwards. These two are how a
 * reader says so — a highlight drawn last over an arrow, or an arrow that has
 * ended up under the wash it was meant to point at.
 *
 * Over a selection they keep the selection's own order: bringing three marks
 * to the front puts all three above everything else without shuffling them
 * among themselves, which is what every drawing program has taught people to
 * expect.
 */
export function raiseMarks(marks: ScoreMark[] | undefined, ids: string[]): ScoreMark[] {
  const set = new Set(ids)
  const list = marks ?? []
  return [...list.filter((m) => !set.has(m.id)), ...list.filter((m) => set.has(m.id))]
}

export function lowerMarks(marks: ScoreMark[] | undefined, ids: string[]): ScoreMark[] {
  const set = new Set(ids)
  const list = marks ?? []
  return [...list.filter((m) => set.has(m.id)), ...list.filter((m) => !set.has(m.id))]
}

/**
 * Copy a selection, offset a little so the copies are visibly *copies* rather
 * than something that looks like nothing happened, and put them on top —
 * which is where the things you just made belong. Returns the new ids too,
 * since the caller selects what it just made.
 */
export function duplicateMarks(
  marks: ScoreMark[] | undefined,
  ids: string[],
): { marks: ScoreMark[]; ids: string[] } {
  const set = new Set(ids)
  const list = marks ?? []
  const copies = list
    .filter((m) => set.has(m.id))
    .map((m) => ({ ...moveMark(m, DUPLICATE_OFFSET, DUPLICATE_OFFSET), id: newId() }))
  return { marks: [...list, ...copies], ids: copies.map((c) => c.id) }
}

/** How far a duplicate sits from its original, as a fraction of the page. */
const DUPLICATE_OFFSET = 0.02

/** Drop one mark by id. */
export function removeMark(
  marks: ScoreMark[] | undefined,
  id: string,
): ScoreMark[] {
  return removeMarks(marks, [id])
}

/** Drop several — the eraser's sweep, or a selection deleted at once. */
export function removeMarks(
  marks: ScoreMark[] | undefined,
  ids: string[],
): ScoreMark[] {
  const set = new Set(ids)
  return (marks ?? []).filter((m) => !set.has(m.id))
}

/**
 * Every mark whose box meets a rectangle — what a marquee selects. *Meets*
 * rather than *inside*: a drag that catches the corner of a long highlight
 * has caught it, and demanding the whole thing be enclosed makes a marquee
 * the most frustrating tool on the page.
 */
export function marksInRect(
  marks: ScoreMark[],
  r: { x: number; y: number; w: number; h: number },
): ScoreMark[] {
  const [rx0, rx1] = [Math.min(r.x, r.x + r.w), Math.max(r.x, r.x + r.w)]
  const [ry0, ry1] = [Math.min(r.y, r.y + r.h), Math.max(r.y, r.y + r.h)]
  return marks.filter((m) => {
    const [x0, x1] = [Math.min(m.x, m.x + m.w), Math.max(m.x, m.x + m.w)]
    const [y0, y1] = [Math.min(m.y, m.y + m.h), Math.max(m.y, m.y + m.h)]
    return x0 <= rx1 && x1 >= rx0 && y0 <= ry1 && y1 >= ry0
  })
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

// ---- drawing geometry ------------------------------------------------------
// Shared by every renderer of a mark — the page on screen, a quote's crop and
// the marked-up PDF — because a mark that is one thickness on screen and
// another in the handout is two marks.

/**
 * A mark's stroke in the units of a page `width` wide. Scaled off the width so
 * a line drawn on a page fitted to a narrow panel doesn't become a smear when
 * the same page is expanded; the floor keeps a fine line visible at all.
 */
export function strokeOf(weight: number | undefined, width: number, floor = 1.25): number {
  return Math.max(floor, ((weight ?? DEFAULT_MARK_WEIGHT) * width) / 620)
}

/**
 * An arrow's two head wings, for a shaft from (x, y) to (x + w, y + h) in any
 * units. The head is capped against the shaft: on a short arrow a fixed head
 * is the whole arrow, and on a long one it disappears. Null for an arrow too
 * short to have a direction.
 */
export function arrowWings(
  x: number,
  y: number,
  w: number,
  h: number,
  stroke: number,
): [[number, number], [number, number]] | null {
  const length = Math.hypot(w, h)
  if (length < 1) return null
  const head = Math.min(stroke * 4.5, length * 0.4)
  const angle = Math.atan2(h, w)
  const wing = (spread: number): [number, number] => [
    x + w - head * Math.cos(angle - spread),
    y + h - head * Math.sin(angle - spread),
  ]
  return [wing(0.42), wing(-0.42)]
}

/** A highlighter's wash: its opacity over the page, multiplied. */
export const HIGHLIGHT_OPACITY = 0.34

// ---- text ------------------------------------------------------------------
// A text mark is words on the page — "cresc. from here", "2nd time only" —
// the one thing a teacher's own copy of a score always has. Sized as a
// fraction of the page's *width*, like a stroke, so the words keep their size
// against the music through every refit and expand.

/** The face every renderer draws text marks in: the screen, a crop, the PDF. */
export const TEXT_FONT = 'Helvetica, Arial, sans-serif'

/** Line height, as a multiple of the type size. */
export const TEXT_LEADING = 1.2

/**
 * Where a line's baseline sits below its top, as a multiple of the size.
 * Stated rather than left to each renderer's idea of a baseline: SVG, a
 * canvas and pdf-lib all default to different ones, and a word that moves
 * half a line between the screen and the handout is a word in the wrong bar.
 */
export const TEXT_ASCENT = 0.82

/** Type size for a weight, as a fraction of the page's width. */
export function textSizeOf(weight: number | undefined): number {
  return TEXT_SIZES[Math.min(3, Math.max(1, Math.round(weight ?? DEFAULT_MARK_WEIGHT)))]
}
const TEXT_SIZES: Record<number, number> = { 1: 0.02, 2: 0.027, 3: 0.036 }

/** How long a text mark may be — words on a score, not an essay. */
export const MAX_MARK_TEXT = 280

/**
 * The box a text mark's words fill, in page fractions, for a page of the
 * given pixel size. Measured once, when the words are set, so nothing that
 * hit-tests or draws grips has to know about fonts.
 */
export function measureText(
  text: string,
  weight: number | undefined,
  page: { width: number; height: number },
): { w: number; h: number } {
  const size = textSizeOf(weight) * page.width
  const lines = text.split('\n')
  let widest = 0
  const ctx = measurer()
  if (ctx) {
    ctx.font = `${size}px ${TEXT_FONT}`
    for (const line of lines) widest = Math.max(widest, ctx.measureText(line).width)
  } else {
    // No canvas (a test, a worker): Helvetica averages a little over half an
    // em per character, which is near enough to hit-test by.
    widest = Math.max(...lines.map((l) => l.length)) * size * 0.55
  }
  return {
    w: Math.max(widest, size * 0.5) / page.width,
    h: (lines.length * size * TEXT_LEADING) / page.height,
  }
}

let measuring: CanvasRenderingContext2D | null | undefined
function measurer(): CanvasRenderingContext2D | null {
  if (measuring !== undefined) return measuring
  measuring =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d')
  return measuring
}

// ---- constraint ------------------------------------------------------------
// Shift while drawing. Worked in *pixels*, not fractions: a page is taller
// than it is wide, so a "square" in page fractions is a tall rectangle on the
// screen, and a 45° line in fractions leans.

/**
 * The corner a Shift-drag reaches: equal sides on screen, following whichever
 * way the pointer went furthest, so the square grows under the hand rather
 * than lagging behind it on one axis.
 */
export function squareCorner(
  from: { x: number; y: number },
  to: { x: number; y: number },
  page: { width: number; height: number },
): { x: number; y: number } {
  const dx = (to.x - from.x) * page.width
  const dy = (to.y - from.y) * page.height
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return {
    x: from.x + (Math.sign(dx || 1) * side) / page.width,
    y: from.y + (Math.sign(dy || 1) * side) / page.height,
  }
}

/** A Shift-drawn line snaps to the nearest 15° on screen, keeping its length. */
export function snapAngle(
  from: { x: number; y: number },
  to: { x: number; y: number },
  page: { width: number; height: number },
): { x: number; y: number } {
  const dx = (to.x - from.x) * page.width
  const dy = (to.y - from.y) * page.height
  const length = Math.hypot(dx, dy)
  const step = Math.PI / 12
  const angle = Math.round(Math.atan2(dy, dx) / step) * step
  return {
    x: from.x + (Math.cos(angle) * length) / page.width,
    y: from.y + (Math.sin(angle) * length) / page.height,
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

// ---- resizing --------------------------------------------------------------
// A mark drawn a little too small is the ordinary case, and the only way to
// fix one used to be to delete it and draw it again. These are the grips the
// selected mark wears, in page fractions like everything else.

/** Which grip is being dragged. Arrows have ends rather than corners. */
export type MarkHandle = 'nw' | 'ne' | 'sw' | 'se' | 'tail' | 'head'

/**
 * The grips a mark offers, as page fractions.
 *
 * An arrow's are its two ends, because an arrow *is* a tail and a head — a
 * corner grip on one would let you drag a box round it that means nothing.
 * Freehand ink offers none: scaling a stroke would rewrite every one of its
 * points, and a hand-drawn line redrawn is quicker than a hand-drawn line
 * stretched.
 */
export function handlesOf(mark: ScoreMark): { id: MarkHandle; x: number; y: number }[] {
  // Text is sized by its weight, like a font menu — dragging a corner would
  // either stretch the letters or ask what that means, and neither is text.
  if (mark.kind === 'ink' || mark.kind === 'text') return []
  if (mark.kind === 'arrow')
    return [
      { id: 'tail', x: mark.x, y: mark.y },
      { id: 'head', x: mark.x + mark.w, y: mark.y + mark.h },
    ]
  const [x0, x1] = [Math.min(mark.x, mark.x + mark.w), Math.max(mark.x, mark.x + mark.w)]
  const [y0, y1] = [Math.min(mark.y, mark.y + mark.h), Math.max(mark.y, mark.y + mark.h)]
  return [
    { id: 'nw', x: x0, y: y0 },
    { id: 'ne', x: x1, y: y0 },
    { id: 'sw', x: x0, y: y1 },
    { id: 'se', x: x1, y: y1 },
  ]
}

/**
 * The mark with one grip dragged to (x, y). The opposite corner stays put, so
 * the two edges the pointer isn't touching don't move — the same rule the
 * score quote's frame obeys, and the one people expect from every handle they
 * have ever dragged.
 */
export function resizeMark(
  mark: ScoreMark,
  handle: MarkHandle,
  x: number,
  y: number,
): ScoreMark {
  if (handle === 'tail') return { ...mark, x, y, w: mark.x + mark.w - x, h: mark.y + mark.h - y }
  if (handle === 'head') return { ...mark, w: x - mark.x, h: y - mark.y }
  const x0 = Math.min(mark.x, mark.x + mark.w)
  const x1 = Math.max(mark.x, mark.x + mark.w)
  const y0 = Math.min(mark.y, mark.y + mark.h)
  const y1 = Math.max(mark.y, mark.y + mark.h)
  const left = handle === 'nw' || handle === 'sw' ? x : x0
  const right = handle === 'ne' || handle === 'se' ? x : x1
  const top = handle === 'nw' || handle === 'ne' ? y : y0
  const bottom = handle === 'sw' || handle === 'se' ? y : y1
  return {
    ...mark,
    x: Math.min(left, right),
    y: Math.min(top, bottom),
    w: Math.abs(right - left),
    h: Math.abs(bottom - top),
  }
}

/** How small a resized mark may get, as a fraction of the page. */
export const MIN_MARK = 0.006

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
