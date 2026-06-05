/**
 * Auto-fit the workspace to the current screen — the "Fit" button's brain.
 *
 * One pure function: given the live measurements of the player|notes(|inspector)
 * row, it returns the optimal column widths and video height. The app measures,
 * calls this, then applies + persists the result (a one-shot fit, not a live
 * resize). Keeping the math here makes it tweakable and unit-testable, with no
 * React or DOM in the way.
 *
 * Strategy:
 *  - Horizontal: notes and the docked inspector each get a screen-proportional
 *    width inside a comfortable band; the player (flex) keeps whatever's left,
 *    never below its minimum (trim notes, then the inspector, to guarantee it).
 *  - Vertical: the video and the overview band share one pool (everything in the
 *    player column that isn't fixed chrome). The horizontal overview takes a
 *    compact fixed floor; the video takes the rest, capped by what its column
 *    width allows at 16:9 and by a share of the column height.
 *
 * The constants are deliberately grouped and named so the whole feel can be
 * retuned here without touching the wiring.
 */

export interface FitMeasurements {
  /** Width (px) of the player|notes(|inspector) row — i.e. the main area, which
   *  already excludes the sidebar (Fit respects whether it's open). */
  rowWidth: number
  /** Height (px) of that row = the player column height (side-by-side only). */
  rowHeight: number
  /** Current video height + overview-band height (px). Their sum is the pool the
   *  vertical fit re-divides, and it's invariant to the horizontal split because
   *  the overview is flex-1 (= pool − video) however wide the column gets. */
  videoOverviewPool: number
  /** Whether the docked inspector column is present (reserve width for it). */
  hasInspector: boolean
}

export interface FitLayout {
  /** Target width (px) for the notes column. */
  notesWidth: number
  /** Target width (px) for the docked inspector (0 when none is shown). */
  inspectorWidth: number
  /** Target max height (px) for the video. */
  playerHeight: number
}

// --- horizontal bands (px) — mirror the drag clamps elsewhere in the app ---
const HANDLE_W = 4 // each inter-column drag handle (w-1)
const PLAYER_MIN_W = 360 // the reserve the split/inspector drags already keep
const NOTES_FRACTION = 0.32
const NOTES_MIN_W = 360
const NOTES_MAX_W = 600
const INSPECTOR_FRACTION = 0.24
const INSPECTOR_MIN_W = 300
const INSPECTOR_MAX_W = 460

// --- vertical bands (px) ---
const VIDEO_MIN_H = 160
const VIDEO_MAX_COLUMN_FRACTION = 0.52 // don't let the video eat the column
const OVERVIEW_MIN_H = 130 // the horizontal band + tag footer stay usable

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function computeFitLayout(m: FitMeasurements): FitLayout {
  const { rowWidth, rowHeight, videoOverviewPool, hasInspector } = m

  // Degenerate measurements (unmounted / zero-size): hand back sane minimums.
  if (rowWidth <= 0 || rowHeight <= 0) {
    return {
      notesWidth: NOTES_MIN_W,
      inspectorWidth: hasInspector ? INSPECTOR_MIN_W : 0,
      playerHeight: VIDEO_MIN_H,
    }
  }

  // --- horizontal: notes + inspector widths, player absorbs the rest ---
  const handles = hasInspector ? HANDLE_W * 2 : HANDLE_W
  let inspector = hasInspector
    ? clamp(Math.round(rowWidth * INSPECTOR_FRACTION), INSPECTOR_MIN_W, INSPECTOR_MAX_W)
    : 0
  let notes = clamp(Math.round(rowWidth * NOTES_FRACTION), NOTES_MIN_W, NOTES_MAX_W)

  // Guarantee the player's minimum by trimming notes first, then the inspector.
  let player = rowWidth - handles - notes - inspector
  if (player < PLAYER_MIN_W) {
    const deficit = PLAYER_MIN_W - player
    const fromNotes = Math.min(deficit, notes - NOTES_MIN_W)
    notes -= fromNotes
    const rest = deficit - fromNotes
    if (rest > 0 && hasInspector) {
      inspector = Math.max(INSPECTOR_MIN_W, inspector - rest)
    }
    player = rowWidth - handles - notes - inspector
  }
  const playerColWidth = Math.max(PLAYER_MIN_W, player)

  // --- vertical: divide the video|overview pool ---
  const videoCapByWidth = (playerColWidth * 9) / 16 // 16:9 height the width allows
  // The horizontal overview wants a compact, fixed band — notes spread along its
  // width, so a denser track no longer needs more height.
  const overviewWant = OVERVIEW_MIN_H

  let video = videoOverviewPool - overviewWant
  video = Math.min(video, videoCapByWidth, rowHeight * VIDEO_MAX_COLUMN_FRACTION)
  video = Math.max(VIDEO_MIN_H, video)
  // If that floor would starve the overview below its hard minimum, give the
  // overview priority and shrink the video back down.
  if (videoOverviewPool - video < OVERVIEW_MIN_H) {
    video = Math.max(VIDEO_MIN_H, videoOverviewPool - OVERVIEW_MIN_H)
  }

  return {
    notesWidth: Math.round(notes),
    inspectorWidth: Math.round(inspector),
    playerHeight: Math.round(video),
  }
}
