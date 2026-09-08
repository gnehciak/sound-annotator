import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Loader2, Crosshair } from 'lucide-react'
import type { Annotation, NoteOverlay } from '../types'
import { fileToScaledBlob } from '../lib/image'
import {
  HOLD_MAX,
  HOLD_MIN,
  OVERLAY_HOLD,
  clampHold,
  coverPosition,
  hasCover,
  hasPin,
  hasOverlay,
  isFilled,
  isScorePin,
  patchOverlay,
  pinPageOf,
} from '../lib/overlays'
import { pinTargetAt, type PinDrop } from '../lib/pinTargets'

interface Props {
  annotation: Annotation
  /** The note's hue — the pin key shows the dot it actually places. */
  color: string
  onUpdate: (
    patch: Partial<Annotation>,
    opts?: { mode?: 'text'; coalesceKey?: string },
  ) => void
  /** Uploads a blob and resolves with its public URL (see lib/imageCloud). */
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
  /**
   * The score page currently on screen, when the track has a score at all.
   * Absent means there is nothing to anchor a pin to but the frame.
   */
  scorePage?: number
  /** The track has a score, but it's switched off — so a score pin won't show. */
  scoreHidden?: boolean
}

/**
 * A cover is shown at full frame, so it's worth more pixels than an inline note
 * image — but not so many that a class on a phone hotspot waits on it.
 * `fileToScaledBlob` downscales to this and re-encodes (WebP where the source
 * can carry transparency, else JPEG), so what leaves the browser is a fraction
 * of what a phone photo or a screen grab weighs.
 */
const COVER_MAX_DIM = 1600

/** How far the pointer has to travel before a press counts as a drag, not a click. */
const DRAG_SLOP = 4

/**
 * The note's stage controls: what it puts on the video while it's on screen —
 * a cover image standing in for the picture, and a pin dropped on the frame
 * that captions itself with the note's own text.
 *
 * Both are **objects, not switches**: a 16:9 cover slot that echoes the frame's
 * shape, and the pin itself — the dot in the note's hue, in a recessed key you
 * drag onto the picture. Where it lands is what it's anchored to, so placing
 * and anchoring stay one gesture; a plain click drops it dead centre, and
 * clicking a placed pin takes it off again.
 *
 * Video projects only; the host decides that (an audio track's waveform is the
 * picture and must stay uncovered) and simply doesn't render this.
 */
export default function NoteOverlayControls({
  annotation,
  color,
  onUpdate,
  uploadImage,
  scorePage,
  scoreHidden,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Depth counter, not a boolean: dragging across a child fires `dragleave` on
  // the parent, which would flicker the highlight off mid-hover.
  const [dragDepth, setDragDepth] = useState(0)
  const overlay: NoteOverlay = annotation.overlay ?? {}
  const busy = progress != null
  const crop = coverPosition(annotation)
  const cropMoved = crop.x !== 0.5 || crop.y !== 0.5

  const patch = (next: Partial<NoteOverlay>) =>
    onUpdate(patchOverlay(annotation, next))

  const pickCover = async (file: File | undefined | null) => {
    if (!file || !uploadImage) return
    if (!file.type.startsWith('image/')) {
      setError('That file isn’t an image.')
      return
    }
    setError(null)
    setProgress(0)
    try {
      const blob = await fileToScaledBlob(file, COVER_MAX_DIM)
      // The old cover is left in the Blob store on purpose: the image sweep
      // (api/blobs/gc.ts) collects it on the next load, once the *saved* notes
      // no longer name it — so an undo of this replacement still has bytes to
      // come back to.
      patch({ coverUrl: await uploadImage(blob, setProgress) })
    } catch (err) {
      console.error('Cover image upload failed:', err)
      setError('That image couldn’t be uploaded — try again.')
    } finally {
      setProgress(null)
    }
  }

  // Drop an image anywhere on this section to set (or replace) the cover.
  const dropZone = {
    onDragEnter: (e: DragEvent) => {
      if (!uploadImage || !e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragDepth((d) => d + 1)
    },
    onDragOver: (e: DragEvent) => {
      if (!uploadImage || !e.dataTransfer.types.includes('Files')) return
      // Without this the browser navigates away to the dropped file.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: () => setDragDepth((d) => Math.max(0, d - 1)),
    onDrop: (e: DragEvent) => {
      if (!uploadImage) return
      e.preventDefault()
      setDragDepth(0)
      void pickCover(e.dataTransfer.files?.[0])
    },
  }
  const dropping = dragDepth > 0 && !!uploadImage

  const pinned = hasPin(annotation)
  const covered = hasCover(annotation)
  const pinnedToScore = isScorePin(annotation)
  const pinPage = pinPageOf(annotation)

  const removePin = () =>
    patch({ pinX: undefined, pinY: undefined, pinAnchor: undefined, pinPage: undefined })
  // A pin placed without aiming lands dead centre, where it's impossible to
  // miss; dragging is how it gets aimed.
  const centrePin = () => patch({ pinX: 0.5, pinY: 0.5 })

  /**
   * Move the pin between the two things it can be a fraction of. The
   * fractions themselves are kept: the frame and a page are different shapes,
   * so nothing could carry the position across faithfully, and a pin that
   * stays where its numbers say is easier to reason about than one that jumps
   * somewhere computed. Dead centre stays dead centre.
   */
  const anchorTo = (score: boolean) =>
    patch(
      score
        ? { pinAnchor: 'score', pinPage: scorePage ?? 1 }
        : { pinAnchor: undefined, pinPage: undefined },
    )

  /**
   * Dragging the pin out of the key and onto the picture.
   *
   * One gesture, two outcomes: where it lands decides what it is anchored to,
   * because the thing you dropped it on *is* the answer — the score's page for
   * a place in the music, the frame for a place on screen. That saves the
   * round trip of switching a pin on, hunting for the dot at dead centre, and
   * dragging it to where you meant in the first place.
   *
   * Pointer events rather than HTML5 drag-and-drop: this needs a live readout
   * of what's under the cursor, and the drop boxes are `pointer-events: none`
   * (so they don't eat the player's clicks), which drag-and-drop would skip
   * entirely. lib/pinTargets.ts does the hit-testing by geometry.
   */
  const [placing, setPlacing] = useState<{
    x: number
    y: number
    over: PinDrop | null
  } | null>(null)
  // Where the press started, and whether it has travelled far enough to be a
  // drag. A press that never moves is a click, and toggles the pin instead.
  const pressRef = useRef<{ x: number; y: number; dragged: boolean } | null>(null)

  const startPlacing = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the drag still tracks while the pointer is over the key */
    }
    pressRef.current = { x: e.clientX, y: e.clientY, dragged: false }
  }

  const movePlacing = (e: ReactPointerEvent<HTMLElement>) => {
    const press = pressRef.current
    if (!press) return
    if (
      !press.dragged &&
      Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_SLOP
    )
      return
    press.dragged = true
    setPlacing({ x: e.clientX, y: e.clientY, over: pinTargetAt(e.clientX, e.clientY) })
  }

  const endPlacing = (e: ReactPointerEvent<HTMLElement>) => {
    const press = pressRef.current
    pressRef.current = null
    setPlacing(null)
    if (!press) return
    // A press that never travelled is a click: place it centre, or take it off.
    if (!press.dragged) {
      if (pinned) removePin()
      else centrePin()
      return
    }
    const drop = pinTargetAt(e.clientX, e.clientY)
    // Dropped on nothing: no pin, no change. A gesture that fizzles is better
    // than one that leaves a dot somewhere nobody aimed.
    if (!drop) return
    patch(
      drop.kind === 'score'
        ? {
            pinX: drop.x,
            pinY: drop.y,
            pinAnchor: 'score',
            pinPage: drop.page ?? scorePage ?? 1,
          }
        : { pinX: drop.x, pinY: drop.y, pinAnchor: undefined, pinPage: undefined },
    )
  }

  const cancelPlacing = () => {
    pressRef.current = null
    setPlacing(null)
  }

  // Keyboard: the key is a switch, and once placed the arrows aim it — the one
  // path to a pin's position that doesn't need a pointer.
  const nudgePin = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const by = e.shiftKey ? 0.05 : 0.01
    const at = { x: overlay.pinX ?? 0.5, y: overlay.pinY ?? 0.5 }
    const move = (dx: number, dy: number) => {
      e.preventDefault()
      patch({
        pinX: Math.min(1, Math.max(0, at.x + dx)),
        pinY: Math.min(1, Math.max(0, at.y + dy)),
      })
    }
    if (!pinned) return
    if (e.key === 'ArrowLeft') move(-by, 0)
    else if (e.key === 'ArrowRight') move(by, 0)
    else if (e.key === 'ArrowUp') move(0, -by)
    else if (e.key === 'ArrowDown') move(0, by)
  }

  // What the two objects add up to, said once, instead of a caption under each.
  const stageLine = !pinned
    ? covered
      ? 'Cover set — drag the dot on to add a caption'
      : scorePage != null
        ? 'Drag the dot onto the picture, or onto the score’s page'
        : 'Drag the dot onto the picture'
    : covered
      ? `Cover set · pin ${pinnedToScore ? `on page ${pinPage}` : 'on the frame'}`
      : pinnedToScore
        ? `Pinned on page ${pinPage} of the score`
        : 'Pinned on the frame'

  return (
    <div
      {...dropZone}
      className={`relative border-b transition-colors ${
        dropping ? 'border-accent/40 bg-accent/[0.06]' : 'border-line/60'
      }`}
    >
      {/* ---- the two objects ---- */}
      <div className="flex items-center gap-2.5 px-[13px] py-2.5">
        {/* The cover slot echoes the frame's shape: empty it's a dashed 16:9
            well, set it *is* the picture. Clicking picks a file; dropping one
            anywhere on this section does the same. */}
        <button
          type="button"
          disabled={!uploadImage || busy}
          onClick={() => fileRef.current?.click()}
          title={
            covered
              ? 'Replace the cover image'
              : 'Show an image over the video while this note is on screen — or drop one here'
          }
          aria-label={covered ? 'Replace cover image' : 'Add a cover image'}
          className={`press grid h-[34px] w-[60px] shrink-0 place-items-center overflow-hidden rounded-md border text-muted transition-colors disabled:cursor-default disabled:opacity-50 ${
            covered
              ? 'border-line bg-black'
              : 'border-dashed border-line-strong bg-inset hover:border-accent/70 hover:text-accentink'
          }`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin" />
          ) : covered ? (
            <img
              src={overlay.coverUrl}
              alt=""
              style={
                isFilled(annotation)
                  ? { objectPosition: `${crop.x * 100}% ${crop.y * 100}%` }
                  : undefined
              }
              className={`h-full w-full ${
                isFilled(annotation) ? 'object-cover' : 'object-contain'
              }`}
            />
          ) : (
            <ImageIcon size={14} />
          )}
        </button>

        {/* The pin, as the thing it places. Drag it onto the picture (or the
            score's page); click to drop it centre, click again to take it off. */}
        <button
          type="button"
          role="switch"
          aria-checked={pinned}
          onPointerDown={startPlacing}
          onPointerMove={movePlacing}
          onPointerUp={endPlacing}
          onPointerCancel={cancelPlacing}
          onKeyDown={nudgePin}
          title={
            scorePage != null
              ? 'Drag onto the video, or onto the score’s page — click to place it centre'
              : 'Drag onto the video to place the pin — click to place it centre'
          }
          aria-label="Pin a caption on the picture"
          className={`press grid h-[34px] w-[34px] shrink-0 cursor-grab touch-none place-items-center rounded-full border bevel-inset bg-inset transition-colors active:cursor-grabbing ${
            placing
              ? 'border-accent'
              : pinned
                ? 'border-line-strong'
                : 'border-line hover:border-line-strong'
          }`}
        >
          {/* The same dot PinLayer draws: a core in the note's hue ringed
              white, over a breathing halo once it's actually out there. */}
          <span className="relative grid h-[18px] w-[18px] place-items-center">
            {pinned && (
              <span className="absolute inset-0 rounded-full opacity-30">
                <span
                  className="block h-full w-full animate-now-pulse rounded-full"
                  style={{ backgroundColor: color }}
                />
              </span>
            )}
            <span
              className="relative block h-2.5 w-2.5 rounded-full ring-2 ring-white/90"
              style={{ backgroundColor: color }}
            />
          </span>
        </button>

        <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted">
          {stageLine}
        </span>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pickCover(e.target.files?.[0])
          // Let the same file be chosen again after a removal.
          e.target.value = ''
        }}
      />

      {/* ---- what each object needs told, once it exists ---- */}
      {(covered || pinned) && (
        <div className="flex flex-col gap-2 px-[13px] pb-2.5">
          {covered && (
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="seg"
                role="group"
                aria-label="How the cover fits the frame"
              >
                {(['contain', 'cover'] as const).map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    className="seg-item press"
                    aria-pressed={(overlay.coverFit ?? 'contain') === fit}
                    title={
                      fit === 'contain'
                        ? 'Show the whole image, letterboxed'
                        : 'Fill the frame, cropping the overflow — then drag the cover on the video to aim the crop'
                    }
                    onClick={() =>
                      patch({ coverFit: fit === 'contain' ? undefined : 'cover' })
                    }
                  >
                    {fit === 'contain' ? 'Fit' : 'Fill'}
                  </button>
                ))}
              </div>
              {/* Filling crops, and which part it keeps is aimed on the frame
                  itself, where the picture is. Only the way back to centre
                  needs a control here. */}
              {isFilled(annotation) && (
                <button
                  type="button"
                  disabled={!cropMoved}
                  onClick={() => patch({ coverX: undefined, coverY: undefined })}
                  title="Put the crop back in the middle"
                  className="btn-ghost btn-sm press"
                >
                  <Crosshair size={11} />
                  Centre
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() =>
                  patch({
                    coverUrl: undefined,
                    coverFit: undefined,
                    coverX: undefined,
                    coverY: undefined,
                  })
                }
                title="Remove the cover image"
                className="btn-ghost btn-sm press hover:border-danger/60 hover:text-danger"
              >
                Remove cover
              </button>
            </div>
          )}

          {pinned && (
            <div className="flex flex-wrap items-center gap-2">
              {/* What the pin's position is a fraction *of*. On the frame it
                  holds a place on the picture; on the score it holds a place in
                  the music, and rides every rescale, refit and scroll. */}
              <div className="seg" role="group" aria-label="What the pin is anchored to">
                <button
                  type="button"
                  onClick={() => anchorTo(false)}
                  aria-pressed={!pinnedToScore}
                  title="The pin holds its place on the picture"
                  className="seg-item press"
                >
                  Frame
                </button>
                <button
                  type="button"
                  onClick={() => anchorTo(true)}
                  aria-pressed={pinnedToScore}
                  disabled={scorePage == null}
                  title={
                    scorePage == null
                      ? 'Attach a PDF score to this track first'
                      : 'The pin holds its place on the page, however the score is sized or moved'
                  }
                  className="seg-item press"
                >
                  Score
                </button>
              </div>
              {pinnedToScore && scoreHidden && (
                <span className="text-[11.5px] text-muted/80">
                  The score is off, so it isn’t showing.
                </span>
              )}
              {pinnedToScore && scorePage != null && scorePage !== pinPage && (
                <button
                  type="button"
                  onClick={() => patch({ pinPage: scorePage })}
                  title={`The score is on page ${scorePage}`}
                  className="btn-ghost btn-sm press"
                >
                  <Crosshair size={11} />
                  Move to page {scorePage}
                </button>
              )}
            </div>
          )}

          {/* How long it stays up. Only a point note needs telling: a note with
              an end already owns a span, and that span is the window. */}
          {hasOverlay(annotation) && annotation.end == null && (
            <label className="flex items-center gap-2 text-[12px] text-muted">
              <span className="shrink-0">Stays up for</span>
              <input
                type="number"
                min={HOLD_MIN}
                max={HOLD_MAX}
                step={1}
                value={clampHold(overlay.hold)}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  patch({
                    hold:
                      Number.isFinite(v) && clampHold(v) !== OVERLAY_HOLD
                        ? clampHold(v)
                        : undefined,
                  })
                }}
                aria-label="Seconds the overlay stays on screen"
                className="field w-16 tabular-nums"
              />
              <span className="shrink-0">seconds</span>
            </label>
          )}
        </div>
      )}

      {error && <p className="px-[13px] pb-2.5 text-[11.5px] text-danger">{error}</p>}

      {/* The ghost: what's under the cursor, and what dropping there means.
          Portalled to the body so no pane's overflow clips it on the way. */}
      {placing &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[90] -translate-y-1/2 translate-x-3"
            style={{ left: placing.x, top: placing.y }}
          >
            <span className="on-video-pop__label whitespace-nowrap rounded-full bg-ink/90 px-2 py-1 text-[11px] text-white shadow-lg ring-1 ring-white/15">
              {placing.over?.kind === 'score'
                ? `Pin to the score — page ${placing.over.page ?? 1}`
                : placing.over?.kind === 'frame'
                  ? 'Pin to the picture'
                  : 'Drop it on the video'}
            </span>
          </div>,
          document.body,
        )}

      {/* The drop target says so only while something is over it. */}
      {dropping && (
        <div className="pointer-events-none absolute inset-1 grid place-items-center rounded-md border border-dashed border-accent/60 bg-ink/70">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-accentink">
            Drop to set the cover
          </span>
        </div>
      )}
    </div>
  )
}
