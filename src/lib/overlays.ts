// The note "stage layer": what a note draws on top of the video — a full-frame
// cover image, a positioned pin captioned with the note's own text, or both.
// See NoteOverlay in ../types for the persisted shape.
//
// Everything here is pure geometry and time; the drawing lives in
// components/VideoOverlays.tsx and the editing controls in NoteInspector.
import type { Annotation, NoteOverlay, NoteQuote } from '../types'
import { notePlainText } from './format'
import { primaryTextHtml } from './noteBlocks'

/**
 * Seconds a point note's layer stays on screen when it carries no `end`.
 * Deliberately a beat longer than the 3s the notes list and overview use to
 * decide which note is "current": that window only tints a row, this one is
 * something the class has to read off the picture.
 */
export const OVERLAY_HOLD = 4

/** Bounds for a hand-typed hold, so a stray keystroke can't park a cover forever. */
export const HOLD_MIN = 1
export const HOLD_MAX = 120

export const hasCover = (a: Annotation): boolean => !!a.overlay?.coverUrl

/** True when the cover fills the frame (and so has a crop worth aiming). */
export const isFilled = (a: Annotation): boolean =>
  a.overlay?.coverFit === 'cover'

/**
 * Which part of a filled cover survives the crop, as 0–1 `object-position`
 * fractions. Dead centre unless the note says otherwise.
 */
export function coverPosition(a: Annotation): { x: number; y: number } {
  return { x: a.overlay?.coverX ?? 0.5, y: a.overlay?.coverY ?? 0.5 }
}

/** A pin on the video frame. */
export const hasVideoPin = (a: Annotation): boolean =>
  a.overlay?.pinX != null && a.overlay?.pinY != null

/**
 * A pin on the score's page. Independent of the video pin — a note may carry
 * one, the other, both or neither — because the two answer different
 * questions: where on the picture, and where in the music.
 */
export const hasScorePin = (a: Annotation): boolean =>
  a.overlay?.scorePinX != null && a.overlay?.scorePinY != null

/** The score page a note's score pin lives on, 1-based; 1 unless it says. */
export const scorePinPageOf = (a: Annotation): number =>
  Math.max(1, Math.round(a.overlay?.scorePinPage ?? 1))

/**
 * True when the note puts anything on the *stage* — the picture or the page,
 * for its moment. Deliberately not counting a score quote: a quote is a
 * picture the note *carries*, and its frame on the page is drawn from the
 * quote itself (`quotesOn`) rather than from this predicate, so a note whose
 * only mark on the world is a quote never counts as having a layer.
 */
export const hasOverlay = (a: Annotation): boolean =>
  hasCover(a) || hasVideoPin(a) || hasScorePin(a)

// ---- score quotes --------------------------------------------------------
// A rectangle on a page of the PDF score, which the note carries as a picture
// wherever it is shown — its row in the list, the inspector, and the printed
// documents. See NoteQuote in ../types for why it is a rectangle and never an
// image, and why the score is the only surface it can be aimed at.

/** How small a quote may be dragged, as a fraction of the page. */
export const MIN_QUOTE = 0.05

/**
 * The rectangle a quote gets when it is dropped rather than drawn — a third of
 * the page, which is big enough to hold a system of music and small enough
 * that what you meant is obvious before you resize it.
 */
export const DEFAULT_QUOTE_W = 0.36
export const DEFAULT_QUOTE_H = 0.24

/** The note's quote, if it has one. */
export const quoteOf = (a: Annotation): NoteQuote | undefined => a.overlay?.quote

/** The page a score quote sits on, 1-based; 1 unless it says. */
export const quotePageOf = (q: NoteQuote): number =>
  Math.max(1, Math.round(q.page ?? 1))

/**
 * The quote to draw on one page of the score, or null. The same choice
 * `scorePinsOn` makes for pins, and made in the same place: nothing downstream
 * has to know which page a quote is aimed at.
 */
export function quoteOn(
  a: Annotation | null | undefined,
  page?: number,
): NoteQuote | null {
  const q = a && quoteOf(a)
  if (!q) return null
  if (page != null && quotePageOf(q) !== page) return null
  return q
}

/** A quote ready to draw: the note it belongs to and the rectangle it framed. */
export interface PlacedQuote {
  note: Annotation
  quote: NoteQuote
}

/**
 * The quotes to frame on one page at time `t` — the *reading* rule, as opposed
 * to the aiming one.
 *
 * Where a note is being edited its own quote is the only one worth drawing:
 * the frame is a tool for aiming, and every other rectangle on the page is in
 * the way of it. A reader has nothing to aim, so the quote joins the pins on
 * the stage under exactly their time rule — while the note is on, the page
 * shows the bars it is about, which is what quoting them was for. Notes are
 * still filtered by page for the pins' reason: a rectangle is a fraction of a
 * page box, and there is nowhere honest to draw one whose page is not on
 * screen.
 */
export function quotesOn(
  annotations: Annotation[],
  page: number,
  t: number,
  selectedId?: string | null,
): PlacedQuote[] {
  return annotations.flatMap((note) => {
    const quote = quoteOn(note, page)
    if (!quote) return []
    if (note.id === selectedId) return [{ note, quote }]
    const { from, to } = overlayWindow(note)
    return t >= from && t <= to ? [{ note, quote }] : []
  })
}

/**
 * Square a dragged rectangle up: inside the page, never smaller than
 * MIN_QUOTE, and with the size honoured ahead of the position, so a rectangle
 * pushed off an edge slides back in rather than being cropped to a sliver.
 */
export function clampQuote(q: NoteQuote): NoteQuote {
  const w = Math.min(1, Math.max(MIN_QUOTE, q.w))
  const h = Math.min(1, Math.max(MIN_QUOTE, q.h))
  return {
    ...q,
    w,
    h,
    x: Math.min(1 - w, Math.max(0, q.x)),
    y: Math.min(1 - h, Math.max(0, q.y)),
  }
}

/** The default rectangle, centred on a point of a page of the score. */
export function quoteAt(x: number, y: number, page: number): NoteQuote {
  return clampQuote({
    on: 'score',
    page: Math.max(1, Math.round(page)),
    x: x - DEFAULT_QUOTE_W / 2,
    y: y - DEFAULT_QUOTE_H / 2,
    w: DEFAULT_QUOTE_W,
    h: DEFAULT_QUOTE_H,
  })
}

/**
 * A pin ready to draw: the note it belongs to and where it goes, as 0–1
 * fractions of whichever box is drawing it.
 *
 * The two kinds of pin live in different fields and are drawn into different
 * boxes (the frame by VideoOverlays, the page by ScoreLayer), but past the
 * point of *choosing* the coordinates they are the same thing — which is what
 * lets one PinLayer draw both. `framePins`/`scorePinsOn` are that choice.
 */
export interface PlacedPin {
  note: Annotation
  x: number
  y: number
}

/**
 * A patch that moves a pin of the given kind — the shape both drag handlers
 * hand back, so neither has to know which fields the kind lives in.
 */
export function movePinPatch(
  kind: 'frame' | 'score',
  x: number,
  y: number,
  /**
   * Which page of the score the pin now sits on. Only ever passed when the
   * gesture actually says — dropping one onto a page from its own menu.
   * Dragging a pin inside its page box doesn't move it between pages, and
   * writing the page anyway would let a stale "current page" overwrite a pin's
   * own.
   */
  page?: number,
): Partial<NoteOverlay> {
  return kind === 'score'
    ? { scorePinX: x, scorePinY: y, ...(page != null ? { scorePinPage: page } : {}) }
    : { pinX: x, pinY: y }
}

/**
 * Migrate a note off the overlay shapes earlier versions wrote. Applied
 * wherever notes enter the app — the project loader and the JSON importer —
 * so nothing downstream has to know either shape existed.
 *
 * Two of them:
 *
 *  • the **single pin** that predates the score view, which carried a
 *    `pinAnchor: 'score'` switch instead of the two independent pins there
 *    are now;
 *  • a **quote of the picture**, from when a quote could be aimed at the
 *    frame. It is dropped rather than moved: its fractions are of a 16:9
 *    frame and mean nothing on a portrait page, and what it cropped — the
 *    note's cover image — was never the music. See NoteQuote in ../types.
 *
 * Returns the note untouched (not a copy) when there is nothing to migrate,
 * which is every note written since.
 */
export function withMigratedOverlay(a: Annotation): Annotation {
  const o = a.overlay as (NoteOverlay & LegacyPin) | undefined
  if (!o) return a
  // Read `on` through the older, wider type: today's says `'score'` and only
  // a file (or a row) written before it can say anything else.
  if (o.quote && (o.quote as { on?: string }).on !== 'score') {
    const kept = { ...o }
    delete kept.quote
    return withMigratedOverlay({ ...a, overlay: kept })
  }
  if (o.pinAnchor !== 'score') return a
  const { pinPage, pinX, pinY, ...rest } = o
  delete (rest as LegacyPin).pinAnchor
  return {
    ...a,
    overlay: {
      ...rest,
      // A pin that *was* on the score becomes the score pin, keeping its
      // fractions: they were always fractions of the page box.
      ...(pinX != null && pinY != null
        ? { scorePinX: pinX, scorePinY: pinY, scorePinPage: pinPage ?? 1 }
        : {}),
    },
  }
}

/** The pre-score-view pin fields, read on migration and never written. */
interface LegacyPin {
  pinAnchor?: 'score'
  pinPage?: number
}

/**
 * When the note's layer is on screen, in track seconds. A note with an end owns
 * that span; a point note holds for `hold` (or OVERLAY_HOLD) from its start.
 */
export function overlayWindow(a: Annotation): { from: number; to: number } {
  const from = a.start
  if (a.end != null) return { from, to: Math.max(a.end, from) }
  return { from, to: from + clampHold(a.overlay?.hold) }
}

/** A stored hold, clamped into range; undefined falls back to OVERLAY_HOLD. */
export function clampHold(hold: number | undefined): number {
  if (hold == null || !Number.isFinite(hold)) return OVERLAY_HOLD
  return Math.min(HOLD_MAX, Math.max(HOLD_MIN, hold))
}

/**
 * Which notes are showing their layer at time `t`. `selectedId` — the note open
 * in the inspector — is always in, whatever the playhead says: composing a
 * cover or dragging a pin has to be possible without scrubbing onto its moment.
 */
function showing(
  annotations: Annotation[],
  t: number,
  selectedId?: string | null,
): Annotation[] {
  return annotations.filter((a) => {
    if (!hasOverlay(a)) return false
    if (a.id === selectedId) return true
    const { from, to } = overlayWindow(a)
    return t >= from && t <= to
  })
}

/**
 * The layer to draw over the frame right now: at most one cover (the picture
 * can only be replaced once) plus every visible pin on the frame.
 *
 * Overlapping covers resolve to the one that started latest — the innermost of
 * a set of nested notes, which is the most specific thing the teacher aimed at
 * this moment. The selected note outranks even that, so what you're editing is
 * what you see.
 */
export function visibleLayer(
  annotations: Annotation[],
  t: number,
  selectedId?: string | null,
): { cover: Annotation | null; pins: PlacedPin[] } {
  const live = showing(annotations, t, selectedId)
  const covers = live.filter(hasCover)
  const selectedCover = covers.find((a) => a.id === selectedId)
  const cover =
    selectedCover ??
    covers.reduce<Annotation | null>(
      (best, a) => (best == null || a.start >= best.start ? a : best),
      null,
    )
  return { cover, pins: framePins(live) }
}

/** The pins on the video frame, out of notes already known to be showing. */
export function framePins(live: Annotation[]): PlacedPin[] {
  return live
    .filter(hasVideoPin)
    .map((note) => ({ note, x: note.overlay!.pinX!, y: note.overlay!.pinY! }))
}

/**
 * The score pins on one page, at time `t`. Pins on other pages are simply not
 * drawn: they are fractions of a page box that isn't on screen, and there is
 * nowhere honest to put them.
 */
export function scorePinsOn(
  annotations: Annotation[],
  page: number,
  t: number,
  selectedId?: string | null,
): PlacedPin[] {
  return showing(annotations, t, selectedId)
    .filter((a) => hasScorePin(a) && scorePinPageOf(a) === page)
    .map((note) => ({
      note,
      x: note.overlay!.scorePinX!,
      y: note.overlay!.scorePinY!,
    }))
}

/**
 * Every cover image URL a project's notes reference. Covers live in the same
 * Blob folder as inline note images but are *not* in the note HTML, so the
 * image sweep (api/blobs/gc.ts, which matches URLs against the HTML it's
 * handed) and the project copier would both miss them without this — the sweep
 * by deleting a live cover, the copier by leaving it pointed at the original
 * owner's bytes.
 */
export function coverUrls(annotations: Annotation[]): string[] {
  return annotations
    .map((a) => a.overlay?.coverUrl)
    .filter((u): u is string => !!u)
}

/** The pin's caption: the note's own text, flattened to one plain string. */
export function pinCaption(a: Annotation): string {
  return notePlainText(primaryTextHtml(a)).trim()
}

/** A patch that merges `next` into the note's overlay, dropping it when empty. */
export function patchOverlay(
  a: Annotation,
  next: Partial<NoteOverlay>,
): { overlay: NoteOverlay | undefined } {
  const merged: NoteOverlay = { ...a.overlay, ...next }
  // Prune the keys the caller cleared, so a removed cover doesn't leave
  // `{coverUrl: undefined}` behind to be persisted as a null in jsonb.
  for (const k of Object.keys(merged) as (keyof NoteOverlay)[]) {
    if (merged[k] == null) delete merged[k]
  }
  return { overlay: Object.keys(merged).length > 0 ? merged : undefined }
}
