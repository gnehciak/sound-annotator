// The note "stage layer": what a note draws on top of the video — a full-frame
// cover image, a positioned pin captioned with the note's own text, or both.
// See NoteOverlay in ../types for the persisted shape.
//
// Everything here is pure geometry and time; the drawing lives in
// components/VideoOverlays.tsx and the editing controls in NoteInspector.
import type { Annotation, NoteOverlay } from '../types'
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

export const hasPin = (a: Annotation): boolean =>
  a.overlay?.pinX != null && a.overlay?.pinY != null

/** True when the note puts anything at all on the picture. */
export const hasOverlay = (a: Annotation): boolean => hasCover(a) || hasPin(a)

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
 * can only be replaced once) plus every visible pin.
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
): { cover: Annotation | null; pins: Annotation[] } {
  const live = showing(annotations, t, selectedId)
  const covers = live.filter(hasCover)
  const selectedCover = covers.find((a) => a.id === selectedId)
  const cover =
    selectedCover ??
    covers.reduce<Annotation | null>(
      (best, a) => (best == null || a.start >= best.start ? a : best),
      null,
    )
  return { cover, pins: live.filter(hasPin) }
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
