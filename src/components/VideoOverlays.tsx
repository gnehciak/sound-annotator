import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Move } from 'lucide-react'
import type { Annotation } from '../types'
import { noteLabel } from '../lib/format'
import { colorForId, hueOnDark } from '../lib/noteColors'
import { coverPosition, isFilled, pinCaption, visibleLayer } from '../lib/overlays'

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
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  // Live position while a pin is under the pointer. Held locally rather than
  // written through on every move: a drag would otherwise push a project save
  // (and an undo entry) per pointer event. Committed once, on release.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
    null,
  )
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

  const layer = visibleLayer(annotations, currentTime, selectedId)
  const coverUrl = layer.cover?.overlay?.coverUrl
  const cover = coverUrl && !broken.has(coverUrl) ? layer.cover : null
  const pins = layer.pins
  const editable = !readOnly

  // A filled cover on the open note can be aimed; a contained one has no
  // overflow to choose from, so it stays inert and the frame stays clickable.
  const coverArmed =
    !!cover && editable && !!onMoveCover && cover.id === selectedId && isFilled(cover)

  const posOf = (a: Annotation) =>
    drag?.id === a.id
      ? { x: drag.x, y: drag.y }
      : { x: a.overlay?.pinX ?? 0.5, y: a.overlay?.pinY ?? 0.5 }

  const cropOf = (a: Annotation) =>
    coverDrag?.id === a.id ? { x: coverDrag.x, y: coverDrag.y } : coverPosition(a)

  const fractionAt = (clientX: number, clientY: number) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: clamp01((clientX - box.left) / box.width),
      y: clamp01((clientY - box.top) / box.height),
    }
  }

  // ---- pin drag: the dot goes wherever the pointer is ----------------------

  const startPinDrag = (a: Annotation) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!editable || !onMovePin || a.id !== selectedId) return
    e.preventDefault()
    e.stopPropagation()
    capture(e)
    const at = fractionAt(e.clientX, e.clientY)
    setDrag({ id: a.id, ...(at ?? posOf(a)) })
  }

  const movePinDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    const at = fractionAt(e.clientX, e.clientY)
    if (at) setDrag({ id: drag.id, ...at })
  }

  const endPinDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    release(e)
    onMovePin?.(drag.id, drag.x, drag.y)
    setDrag(null)
  }

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

  if (!cover && pins.length === 0) return null

  return (
    <div
      ref={frameRef}
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

      {pins.map((a) => {
        const { x, y } = posOf(a)
        const hue = a.color ?? colorForId(a.id)
        // The layer is dark whatever the theme, so the hue takes the
        // dark-surface treatment even on the light page.
        const ink = hueOnDark(hue)
        const caption = pinCaption(a)
        const armed = editable && !!onMovePin && a.id === selectedId
        // The box opens away from the nearer edge and is capped at the distance
        // to the far one, so a long note wraps inside the frame instead of
        // running off the picture — then capped again at a readable measure,
        // because a caption spanning half a lecture-hall screen is a wall of
        // text, not an annotation. Both caps are percentages of the frame,
        // which is why the box is a sibling of the dot rather than its child:
        // a percentage needs the frame as its containing block.
        const flipX = x > 0.55
        const flipY = y > 0.72
        const pct = (n: number) => `${n * 100}%`
        // Level the label row with the dot, so the leader runs straight into it.
        const near = (v: string) => `calc(${v} - 11px)`
        const cardStyle: CSSProperties = {
          left: flipX ? undefined : `calc(${pct(x)} + 20px)`,
          right: flipX ? `calc(${pct(1 - x)} + 20px)` : undefined,
          top: flipY ? undefined : near(pct(y)),
          bottom: flipY ? near(pct(1 - y)) : undefined,
          maxWidth: `min(calc(${pct(flipX ? x : 1 - x)} - 28px), 21rem)`,
          ['--hue' as string]: ink,
        }
        return (
          <div key={a.id} className="contents">
            <div
              role={armed ? 'button' : undefined}
              tabIndex={armed ? 0 : undefined}
              aria-label={
                armed ? 'Drag to move this pin, or nudge it with the arrow keys' : undefined
              }
              title={armed ? 'Drag to move — arrow keys nudge, Shift for bigger steps' : undefined}
              onPointerDown={startPinDrag(a)}
              onPointerMove={movePinDrag}
              onPointerUp={endPinDrag}
              onPointerCancel={endPinDrag}
              onKeyDown={nudge(a, armed, { x, y }, onMovePin, 1)}
              style={{ left: pct(x), top: pct(y) }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-full p-2 ${
                armed ? 'pointer-events-auto cursor-grab touch-none active:cursor-grabbing' : ''
              }`}
            >
              {/* The dot: a solid core in the note's hue, ringed in white so it
                  reads against any frame, over a breathing halo of the same
                  hue. The halo is two elements, not one — `animate-now-pulse`
                  drives opacity to 1 at rest, so its dimming has to live on a
                  wrapper the animation doesn't touch. */}
              <span className="absolute inset-0 rounded-full opacity-30">
                <span
                  className="block h-full w-full animate-now-pulse rounded-full"
                  style={{ backgroundColor: hue }}
                />
              </span>
              <span
                className="relative block h-2.5 w-2.5 rounded-full ring-2 ring-white/90"
                style={{ backgroundColor: hue, boxShadow: '0 2px 10px rgb(0 0 0 / 0.6)' }}
              />
            </div>

            {(caption || armed) && (
              <>
                <span
                  aria-hidden
                  className="on-video-leader animate-fade-in"
                  style={{
                    left: flipX ? undefined : `calc(${pct(x)} + 6px)`,
                    right: flipX ? `calc(${pct(1 - x)} + 6px)` : undefined,
                    top: pct(y),
                    ['--hue' as string]: ink,
                  }}
                />
                <div
                  style={cardStyle}
                  className="on-video-pop absolute w-max animate-fade-in"
                >
                  <span className="on-video-pop__label">
                    {noteLabel(a.start, a.end)}
                  </span>
                  <div className="on-video-pop__body">
                    {caption ? (
                      <p className="on-video-pop__text">{caption}</p>
                    ) : (
                      <p className="on-video-pop__text text-white/45">
                        Type the note&rsquo;s text to caption this pin
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })}
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
