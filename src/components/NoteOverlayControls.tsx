import {
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon, Loader2, Crosshair, Quote, X } from 'lucide-react'
import type { Annotation, NoteOverlay } from '../types'
import { fileToScaledBlob } from '../lib/image'
import {
  HOLD_MAX,
  HOLD_MIN,
  OVERLAY_HOLD,
  clampHold,
  coverPosition,
  hasCover,
  hasScorePin,
  hasVideoPin,
  hasOverlay,
  isFilled,
  patchOverlay,
  quoteAt,
  quoteOf,
  quotePageOf,
  scorePinPageOf,
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
 * What a key in this row is carrying. Both are dragged onto a surface and both
 * read the answer off what they land on, so they share one gesture — only what
 * gets written at the end of it differs.
 */
type Placeable = 'pin' | 'quote'

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

  const quoted = quoteOf(annotation)
  const videoPinned = hasVideoPin(annotation)
  const scorePinned = hasScorePin(annotation)
  const pinned = videoPinned || scorePinned
  const covered = hasCover(annotation)
  const pinPage = scorePinPageOf(annotation)

  /**
   * Which surface a click on the key means. A note has two pins now — one on
   * the picture, one on the page — and the honest answer to "which one did you
   * mean" is whichever you are looking at: the column is showing one or the
   * other, and clicking the key puts a dot in the middle of *that*. Dragging
   * still overrides it, because there the target is the answer.
   */
  const onScoreSurface = scorePage != null && !scoreHidden

  const removeVideoPin = () => patch({ pinX: undefined, pinY: undefined })
  const removeScorePin = () =>
    patch({ scorePinX: undefined, scorePinY: undefined, scorePinPage: undefined })
  // A pin placed without aiming lands dead centre, where it's impossible to
  // miss; dragging is how it gets aimed.
  const centrePin = () =>
    patch(
      onScoreSurface
        ? { scorePinX: 0.5, scorePinY: 0.5, scorePinPage: scorePage ?? 1 }
        : { pinX: 0.5, pinY: 0.5 },
    )

  /**
   * Dragging the pin out of the key and onto the picture.
   *
   * One gesture, two outcomes: where it lands decides *which pin* it is,
   * because the thing you dropped it on *is* the answer — the score's page for
   * a place in the music, the frame for a place on screen. The other pin is
   * left exactly as it was: they are independent, and dropping one on the
   * score is not a way to lose the one already aimed at the picture. That saves the
   * round trip of switching a pin on, hunting for the dot at dead centre, and
   * dragging it to where you meant in the first place.
   *
   * Pointer events rather than HTML5 drag-and-drop: this needs a live readout
   * of what's under the cursor, and the drop boxes are `pointer-events: none`
   * (so they don't eat the player's clicks), which drag-and-drop would skip
   * entirely. lib/pinTargets.ts does the hit-testing by geometry.
   */
  const [placing, setPlacing] = useState<{
    what: Placeable
    x: number
    y: number
    over: PinDrop | null
  } | null>(null)
  // Where the press started, what it is carrying, and whether it has travelled
  // far enough to be a drag. A press that never moves is a click, and toggles
  // the thing instead.
  const pressRef = useRef<{
    what: Placeable
    x: number
    y: number
    dragged: boolean
  } | null>(null)

  // Event first, so the JSX never *calls* this during render: a factory
  // invoked there would put the ref write below in the render phase.
  const startPlacing = (what: Placeable, e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the drag still tracks while the pointer is over the key */
    }
    pressRef.current = { what, x: e.clientX, y: e.clientY, dragged: false }
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
    setPlacing({
      what: press.what,
      x: e.clientX,
      y: e.clientY,
      over: pinTargetAt(e.clientX, e.clientY),
    })
  }

  const endPlacing = (e: ReactPointerEvent<HTMLElement>) => {
    const press = pressRef.current
    pressRef.current = null
    setPlacing(null)
    if (!press) return
    // A press that never travelled is a click: place it centre, or take it off.
    if (!press.dragged) {
      if (press.what === 'quote') {
        // One quote per note, so this really is a toggle: what is on screen is
        // the surface it lands on, the same answer a click on the pin gives.
        patch({
          quote: quoted
            ? undefined
            : quoteAt(
                onScoreSurface ? 'score' : 'video',
                0.5,
                0.5,
                scorePage ?? 1,
              ),
        })
        return
      }
      // Toggle the pin belonging to the surface in view, not "any pin": with
      // two of them, one click clearing both would be a lot to undo.
      if (!(onScoreSurface ? scorePinned : videoPinned)) centrePin()
      else if (onScoreSurface) removeScorePin()
      else removeVideoPin()
      return
    }
    const drop = pinTargetAt(e.clientX, e.clientY)
    // Dropped on nothing: no change. A gesture that fizzles is better than one
    // that leaves something somewhere nobody aimed.
    if (!drop) return
    if (press.what === 'quote') {
      patch({
        quote: quoteAt(
          drop.kind === 'score' ? 'score' : 'video',
          drop.x,
          drop.y,
          drop.page ?? scorePage ?? 1,
        ),
      })
      return
    }
    patch(
      drop.kind === 'score'
        ? {
            scorePinX: drop.x,
            scorePinY: drop.y,
            scorePinPage: drop.page ?? scorePage ?? 1,
          }
        : { pinX: drop.x, pinY: drop.y },
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
    // Aims the pin on the surface in view, the same answer a click gives.
    const onScore = onScoreSurface && scorePinned
    const at = onScore
      ? { x: overlay.scorePinX ?? 0.5, y: overlay.scorePinY ?? 0.5 }
      : { x: overlay.pinX ?? 0.5, y: overlay.pinY ?? 0.5 }
    const move = (dx: number, dy: number) => {
      e.preventDefault()
      const x = Math.min(1, Math.max(0, at.x + dx))
      const y = Math.min(1, Math.max(0, at.y + dy))
      patch(onScore ? { scorePinX: x, scorePinY: y } : { pinX: x, pinY: y })
    }
    if (!(onScore ? scorePinned : videoPinned)) return
    if (e.key === 'ArrowLeft') move(-by, 0)
    else if (e.key === 'ArrowRight') move(by, 0)
    else if (e.key === 'ArrowUp') move(0, -by)
    else if (e.key === 'ArrowDown') move(0, by)
  }

  // What the two objects add up to, said once, instead of a caption under each.
  // Both pins in one phrase — the row answers "what does this note put on
  // screen", and a note may well put something on each.
  const where = [
    videoPinned && 'the frame',
    scorePinned && `page ${pinPage} of the score`,
  ].filter((w): w is string => !!w)
  const stageLine = !pinned
    ? covered
      ? 'Cover set — drag the dot on to add a caption'
      : scorePage != null
        ? 'Drag the dot onto the picture, or onto the score’s page'
        : 'Drag the dot onto the picture'
    : `${covered ? 'Cover set · pinned' : 'Pinned'} on ${where.join(' and on ')}`

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
          onPointerDown={(e) => startPlacing('pin', e)}
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

        {/* The picture quote, as the thing it places: an empty frame with its
            corners, dragged onto whatever the note is quoting. Same gesture as
            the pin — where it lands is the answer — because it is the same
            question asked about a region instead of a point. */}
        <button
          type="button"
          role="switch"
          aria-checked={!!quoted}
          onPointerDown={(e) => startPlacing('quote', e)}
          onPointerMove={movePlacing}
          onPointerUp={endPlacing}
          onPointerCancel={cancelPlacing}
          title={
            scorePage != null
              ? 'Drag onto the score’s page (or the video) to quote that region in the printed notes'
              : 'Drag onto the picture to quote that region in the printed notes'
          }
          aria-label="Quote a region as a picture"
          className={`press grid h-[34px] w-[34px] shrink-0 cursor-grab touch-none place-items-center rounded-full border bevel-inset bg-inset transition-colors active:cursor-grabbing ${
            placing?.what === 'quote'
              ? 'border-accent'
              : quoted
                ? 'border-line-strong'
                : 'border-line hover:border-line-strong'
          }`}
        >
          <span
            style={{ borderColor: quoted ? color : undefined }}
            className={`block h-[15px] w-[18px] rounded-[3px] border-[1.5px] ${
              quoted ? '' : 'border-dashed border-muted'
            }`}
          />
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
      {(covered || pinned || quoted) && (
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

          {/* One row per pin the note actually has — not a switch between
              them. The two are independent: a note may point at a moment on
              the picture *and* at the bar it happens in, and neither row is a
              way to lose the other. */}
          {pinned && (
            <div className="flex flex-wrap items-center gap-2">
              {videoPinned && (
                <button
                  type="button"
                  onClick={removeVideoPin}
                  title="Take the pin off the picture"
                  className="chip chip-outline press hover:border-danger/60 hover:text-danger"
                >
                  On the frame
                  <X size={10} />
                </button>
              )}
              {scorePinned && (
                <button
                  type="button"
                  onClick={removeScorePin}
                  title="Take the pin off the score"
                  className="chip chip-outline press hover:border-danger/60 hover:text-danger"
                >
                  On page {pinPage}
                  <X size={10} />
                </button>
              )}
              {scorePinned && scoreHidden && (
                <span className="text-[11.5px] text-muted/80">
                  The column is on the player, so it isn’t showing.
                </span>
              )}
              {scorePinned && scorePage != null && scorePage !== pinPage && (
                <button
                  type="button"
                  onClick={() => patch({ scorePinPage: scorePage })}
                  title={`The score is on page ${scorePage}`}
                  className="btn-ghost btn-sm press"
                >
                  <Crosshair size={11} />
                  Move to page {scorePage}
                </button>
              )}
            </div>
          )}

          {/* The quote, once it exists: where it is aimed, and — on the
              picture — whether there is a still for it to crop at all. */}
          {quoted && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => patch({ quote: undefined })}
                title="Stop quoting that region"
                className="chip chip-outline press hover:border-danger/60 hover:text-danger"
              >
                <Quote size={10} />
                {quoted.on === 'score'
                  ? `Quoting page ${quotePageOf(quoted)}`
                  : 'Quoting the picture'}
                <X size={10} />
              </button>
              {quoted.on === 'score' &&
                scorePage != null &&
                scorePage !== quotePageOf(quoted) && (
                  <button
                    type="button"
                    onClick={() => patch({ quote: { ...quoted, page: scorePage } })}
                    title={`The score is on page ${scorePage}`}
                    className="btn-ghost btn-sm press"
                  >
                    <Crosshair size={11} />
                    Move to page {scorePage}
                  </button>
                )}
              {/* The one thing a quote of the picture can't do by itself. A
                  YouTube frame's pixels are unreachable to page JS, so what
                  prints is a crop of the note's cover — and without a cover
                  there is nothing to crop. */}
              {quoted.on === 'video' && !covered && (
                <span className="text-[11.5px] text-muted/80">
                  Needs a cover image to print — set one above.
                </span>
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
                ? placing.what === 'quote'
                  ? `Quote page ${placing.over.page ?? 1}`
                  : `Pin to the score — page ${placing.over.page ?? 1}`
                : placing.over?.kind === 'frame'
                  ? placing.what === 'quote'
                    ? 'Quote the picture'
                    : 'Pin to the picture'
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
