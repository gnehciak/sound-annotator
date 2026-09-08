import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Move } from 'lucide-react'
import type { Annotation } from '../types'
import PinLayer from './PinLayer'
import { coverPosition, isFilled, isScorePin, visibleLayer } from '../lib/overlays'
import { usePinTarget } from '../lib/pinTargets'

interface Props {
  annotations: Annotation[]
  /** Track seconds — decides which notes have their layer up. */
  currentTime: number
  /**
   * The note open in the inspector. Its layer shows whatever the playhead says
   * (so a cover can be composed without scrubbing), and it is the only note
   * whose pin can be dragged and whose filled cover can be repositioned.
   */
  selectedId?: string | null
  /** View-only (share links, foreign tracks): draw the layer, never edit it. */
  readOnly?: boolean
  /** Commit a dragged pin's new position, as 0–1 fractions of the frame. */
  onMovePin?: (id: string, x: number, y: number) => void
  /** Commit a repositioned fill crop, as 0–1 object-position fractions. */
  onMoveCover?: (id: string, x: number, y: number) => void
  /**
   * Play/pause, handed to the captions. A caption has to take the pointer to
   * offer its close control, which means it covers the player's own
   * click-to-pause catcher — so it does that job itself instead.
   */
  onTogglePlay?: () => void
}

/** One nudge of the arrow keys, as a fraction of the frame (Shift = ×5). */
const NUDGE = 0.01

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * The note stage layer, drawn inside the video frame (PlayerPane's `overlay`
 * slot, beneath the transport): a full-frame cover image standing in for the
 * picture, and captioned pins sitting on top of it.
 *
 * Inert by default — `pointer-events-none` throughout, so clicking the picture
 * still reaches the player's own click-to-pause catcher underneath. Only the
 * selected note takes the pointer: its pin can be dragged anywhere on the
 * frame, and its cover, when filled, can be dragged to choose which part of
 * the image survives the crop.
 */
export default function VideoOverlays({
  annotations,
  currentTime,
  selectedId,
  readOnly,
  onMovePin,
  onMoveCover,
  onTogglePlay,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  // Same idea for the cover's crop, which needs the grab point too: the image
  // follows the pointer from wherever it was picked up, rather than jumping.
  const [coverDrag, setCoverDrag] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const coverGrab = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(
    null,
  )
  // Cover URLs the browser couldn't load. A cover can outlive its bytes — a
  // copy whose image re-upload failed keeps pointing at the original, which the
  // original's owner may later delete — and a broken-image glyph stretched
  // across the frame is worse than simply showing the video.
  const [broken, setBroken] = useState<Set<string>>(() => new Set())

  const frameTarget = usePinTarget('frame')

  const layer = visibleLayer(annotations, currentTime, selectedId)
  const coverUrl = layer.cover?.overlay?.coverUrl
  const cover = coverUrl && !broken.has(coverUrl) ? layer.cover : null
  const pins = layer.pins.filter((a) => !isScorePin(a))
  const editable = !readOnly

  // A filled cover on the open note can be aimed; a contained one has no
  // overflow to choose from, so it stays inert and the frame stays clickable.
  const coverArmed =
    !!cover && editable && !!onMoveCover && cover.id === selectedId && isFilled(cover)

  const cropOf = (a: Annotation) =>
    coverDrag?.id === a.id ? { x: coverDrag.x, y: coverDrag.y } : coverPosition(a)

  // ---- cover drag: the picture slides under a fixed window -----------------
  // Inverted, because `object-position` names the part of the *image* pinned to
  // the frame: dragging right should reveal what's to the left, which is a
  // smaller percentage. One frame-width of travel sweeps the whole range,
  // which keeps the gesture predictable whatever the image's real overflow is.

  const startCoverDrag = (a: Annotation) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!coverArmed) return
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    const at = cropOf(a)
    coverGrab.current = { clientX: e.clientX, clientY: e.clientY, ...at }
    setCoverDrag({ id: a.id, ...at })
  }

  const moveCoverDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const grab = coverGrab.current
    if (!coverDrag || !grab) return
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return
    setCoverDrag({
      id: coverDrag.id,
      x: clamp01(grab.x - (e.clientX - grab.clientX) / box.width),
      y: clamp01(grab.y - (e.clientY - grab.clientY) / box.height),
    })
  }

  const endCoverDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!coverDrag) return
    release(e)
    onMoveCover?.(coverDrag.id, coverDrag.x, coverDrag.y)
    coverGrab.current = null
    setCoverDrag(null)
  }

  /**
   * Arrow-key nudging, for both draggables — a pin needs it to reach an exact
   * spot, and a crop to be trimmed a hair. `sign` flips it for the cover,
   * whose axis runs the other way (see startCoverDrag).
   */
  const nudge =
    (
      a: Annotation,
      armed: boolean,
      at: { x: number; y: number },
      commit: ((id: string, x: number, y: number) => void) | undefined,
      sign: 1 | -1,
    ) =>
    (e: ReactKeyboardEvent) => {
      const dir = ARROWS[e.key]
      if (!armed || !dir || !commit) return
      e.preventDefault()
      const step = (e.shiftKey ? NUDGE * 5 : NUDGE) * sign
      commit(a.id, clamp01(at.x + dir[0] * step), clamp01(at.y + dir[1] * step))
    }

  // Rendered even when empty, which it often is: this box is what a pin
  // dragged out of the inspector is dropped on (lib/pinTargets.ts), and the
  // moment you most want to drop one is when the note has nothing yet.
  return (
    <div
      ref={(node) => {
        frameRef.current = node
        frameTarget(node)
      }}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {cover && (
        <>
          <img
            // Re-keyed per image so swapping a cover (or crossing from one
            // note's to another's) replays the fade instead of hard-cutting.
            key={`${cover.id}:${coverUrl}`}
            src={coverUrl}
            alt=""
            draggable={false}
            role={coverArmed ? 'button' : undefined}
            tabIndex={coverArmed ? 0 : undefined}
            aria-label={coverArmed ? 'Drag to reposition the cover image' : undefined}
            onError={() =>
              setBroken((prev) =>
                coverUrl && !prev.has(coverUrl) ? new Set(prev).add(coverUrl) : prev,
              )
            }
            onPointerDown={startCoverDrag(cover)}
            onPointerMove={moveCoverDrag}
            onPointerUp={endCoverDrag}
            onPointerCancel={endCoverDrag}
            onKeyDown={nudge(cover, coverArmed, cropOf(cover), onMoveCover, -1)}
            style={
              isFilled(cover)
                ? {
                    objectPosition: `${cropOf(cover).x * 100}% ${cropOf(cover).y * 100}%`,
                  }
                : undefined
            }
            className={`absolute inset-0 h-full w-full animate-fade-in bg-black ${
              isFilled(cover) ? 'object-cover' : 'object-contain'
            } ${
              coverArmed
                ? 'pointer-events-auto cursor-grab touch-none active:cursor-grabbing'
                : ''
            }`}
          />
          {coverArmed && (
            // Chrome, not data: the hint keeps the default white --hue rather
            // than the note's, so hue on this layer only ever means identity.
            <div className="on-video-pop pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 animate-fade-in">
              <span className="on-video-pop__label whitespace-nowrap text-white/75">
                <Move size={11} className="shrink-0" />
                Drag to aim the crop
              </span>
            </div>
          )}
        </>
      )}

      {/* Frame-anchored pins only. A pin aimed at the score's page is drawn
          by ScoreLayer instead, inside the page box, so that it scales and
          scrolls with the page rather than sitting still on the picture. */}
      <PinLayer
        pins={pins}
        selectedId={selectedId}
        readOnly={readOnly}
        onMovePin={onMovePin}
        onTogglePlay={onTogglePlay}
      />
    </div>
  )
}

/** Pointer capture keeps a drag alive once the pointer leaves the element —
 *  the whole point, since aiming something means moving away from it. */
function capture(e: ReactPointerEvent<HTMLElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    /* ignore — the drag still tracks while the pointer is over the element */
  }
}

function release(e: ReactPointerEvent<HTMLElement>) {
  try {
    e.currentTarget.releasePointerCapture(e.pointerId)
  } catch {
    /* ignore */
  }
}
