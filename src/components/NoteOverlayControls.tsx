import {
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  Image as ImageIcon,
  MapPin,
  Trash2,
  Loader2,
  Crosshair,
  GripVertical,
} from 'lucide-react'
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

/**
 * The note's stage controls: what it puts on the video while it's on screen —
 * a cover image standing in for the picture, and a pin dropped on the frame
 * that captions itself with the note's own text.
 *
 * Video projects only; the host decides that (an audio track's waveform is the
 * picture and must stay uncovered) and simply doesn't render this.
 */
export default function NoteOverlayControls({
  annotation,
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

  const togglePin = () => {
    // A new pin lands dead centre, where it's impossible to miss; the frame is
    // where it gets aimed (drag the dot).
    patch(
      hasPin(annotation)
        ? { pinX: undefined, pinY: undefined, pinAnchor: undefined, pinPage: undefined }
        : { pinX: 0.5, pinY: 0.5 },
    )
  }

  const pinnedToScore = isScorePin(annotation)
  const pinPage = pinPageOf(annotation)

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
   * Dragging the pin out of the inspector and onto the picture.
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

  const startPlacing = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the drag still tracks while the pointer is over the handle */
    }
    setPlacing({ x: e.clientX, y: e.clientY, over: pinTargetAt(e.clientX, e.clientY) })
  }

  const movePlacing = (e: ReactPointerEvent<HTMLElement>) => {
    if (!placing) return
    setPlacing({ x: e.clientX, y: e.clientY, over: pinTargetAt(e.clientX, e.clientY) })
  }

  const endPlacing = (e: ReactPointerEvent<HTMLElement>) => {
    if (!placing) return
    setPlacing(null)
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

  return (
    <div
      {...dropZone}
      className={`relative flex flex-col gap-2 border-b px-[13px] py-2.5 transition-colors ${
        dropping ? 'border-accent/40 bg-accent/[0.06]' : 'border-line/60'
      }`}
    >
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        On the video
      </span>

      {/* ---- cover image ---- */}
      {hasCover(annotation) ? (
        <div className="flex flex-col gap-2 rounded-md border border-line/70 p-2">
          <div className="flex items-center gap-2.5">
            <img
              src={overlay.coverUrl}
              alt="Cover"
              style={
                isFilled(annotation)
                  ? { objectPosition: `${crop.x * 100}% ${crop.y * 100}%` }
                  : undefined
              }
              className={`h-11 w-[74px] shrink-0 rounded bg-black ${
                isFilled(annotation) ? 'object-cover' : 'object-contain'
              }`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[11px] text-muted">
                Covers the picture for this note
              </span>
              <div
                className="seg w-max"
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
                        : 'Fill the frame, cropping the overflow — then drag the cover to aim the crop'
                    }
                    onClick={() =>
                      patch({ coverFit: fit === 'contain' ? undefined : 'cover' })
                    }
                  >
                    {fit === 'contain' ? 'Fit' : 'Fill'}
                  </button>
                ))}
              </div>
            </div>
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
              title="Remove cover image"
              aria-label="Remove cover image"
              className="btn-icon press hover:text-danger"
            >
              <Trash2 size={14} />
            </button>
          </div>

          {/* Filling crops, and which part it keeps is the teacher's call —
              aimed on the frame itself, where the picture is. Only the way
              back to centre needs a control here. */}
          {isFilled(annotation) && (
            <div className="flex items-center justify-between gap-2 border-t border-line/50 pt-1.5">
              <span className="text-[11px] leading-snug text-muted/80">
                Drag the cover on the video to aim the crop.
              </span>
              <button
                type="button"
                disabled={!cropMoved}
                onClick={() => patch({ coverX: undefined, coverY: undefined })}
                title="Put the crop back in the middle"
                className="btn-ghost btn-sm press shrink-0"
              >
                <Crosshair size={11} />
                Centre
              </button>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={!uploadImage || busy}
          onClick={() => fileRef.current?.click()}
          title="Show an image over the video while this note is on screen"
          className="press flex w-full items-center justify-between gap-2.5 rounded-md border border-dashed border-line/70 px-[11px] py-2 text-left transition-colors hover:border-line-strong disabled:cursor-default disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-[12.5px] text-muted">
            {busy ? (
              <Loader2 size={14} className="shrink-0 animate-spin" />
            ) : (
              <ImageIcon size={14} className="shrink-0" />
            )}
            {busy
              ? `Uploading… ${Math.round((progress ?? 0) * 100)}%`
              : 'Add a cover image'}
          </span>
          {!busy && (
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted/60">
              or drop
            </span>
          )}
        </button>
      )}
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
      {error && <p className="text-[11.5px] text-danger">{error}</p>}

      {/* ---- pin ---- */}
      <button
        type="button"
        role="switch"
        aria-checked={hasPin(annotation)}
        onClick={togglePin}
        title="Drop a dot on the video, captioned with this note's text"
        className={`press flex w-full items-center justify-between gap-2.5 rounded-md border px-[11px] py-2 text-left transition-colors ${
          hasPin(annotation)
            ? 'border-accent/40 bg-accent/[0.06]'
            : 'border-line/70 hover:border-line-strong'
        }`}
      >
        <span
          className={`flex items-center gap-2 text-[12.5px] ${
            hasPin(annotation) ? 'text-fg' : 'text-muted'
          }`}
        >
          <MapPin size={14} className="shrink-0" />
          Pin a caption
        </span>
        <span className="switch" data-on={hasPin(annotation) || undefined} />
      </button>

      {/* Drag it where you want it. Placing and anchoring are the same motion:
          the picture and the score's page are both drop boxes, and whichever
          one catches it decides what the pin is a fraction of. */}
      <button
        type="button"
        onPointerDown={startPlacing}
        onPointerMove={movePlacing}
        onPointerUp={endPlacing}
        onPointerCancel={endPlacing}
        title={
          scorePage != null
            ? 'Drag onto the video, or onto the score’s page to pin it to the music'
            : 'Drag onto the video to place the pin'
        }
        className={`press flex w-full cursor-grab touch-none items-center gap-2 rounded-md border border-dashed px-[11px] py-1.5 text-left text-[11.5px] active:cursor-grabbing ${
          placing
            ? 'border-accent/60 bg-accent/[0.06] text-fg'
            : 'border-line/70 text-muted hover:border-line-strong hover:text-fg'
        }`}
      >
        <GripVertical size={13} className="shrink-0" />
        {hasPin(annotation) ? 'Drag to re-place it' : 'Drag onto the video to place a pin'}
      </button>

      {hasPin(annotation) && (
        <>
          {/* What the pin's position is a fraction *of*. On the frame it holds
              a place on the picture; on the score it holds a place in the
              music, and rides every rescale, refit and scroll of the page. */}
          <div className="seg grid grid-cols-2">
            <button
              type="button"
              onClick={() => anchorTo(false)}
              aria-pressed={!pinnedToScore}
              title="The pin holds its place on the picture"
              className="seg-item"
            >
              On the frame
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
              className="seg-item"
            >
              On the score
            </button>
          </div>
          <p className="text-[11.5px] leading-relaxed text-muted/80">
            {!pinnedToScore ? (
              <>Drag the dot on the video to aim it. This note’s text is its caption.</>
            ) : (
              <>
                Anchored to <strong className="font-semibold">page {pinPage}</strong> of
                the score — drag it on the page to aim it.{' '}
                {scoreHidden
                  ? 'The score is switched off, so it isn’t showing.'
                  : scorePage != null && scorePage !== pinPage
                    ? `The score is on page ${scorePage}.`
                    : ''}
              </>
            )}
          </p>
          {pinnedToScore && scorePage != null && scorePage !== pinPage && (
            <button
              type="button"
              onClick={() => patch({ pinPage: scorePage })}
              className="btn-ghost btn-sm press w-full justify-center"
            >
              <Crosshair size={12} />
              Move it to page {scorePage}
            </button>
          )}
        </>
      )}

      {/* ---- how long it stays up ----
          Only a point note needs telling: a note with an end already owns a
          span, and that span is the window. */}
      {hasOverlay(annotation) && annotation.end == null && (
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
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
            className="field w-20 tabular-nums"
          />
          <span className="shrink-0">seconds</span>
        </label>
      )}

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
