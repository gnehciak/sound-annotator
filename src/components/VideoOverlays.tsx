import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Annotation } from '../types'
import { colorForId } from '../lib/noteColors'
import { pinCaption, visibleLayer } from '../lib/overlays'

interface Props {
  annotations: Annotation[]
  /** Track seconds — decides which notes have their layer up. */
  currentTime: number
  /**
   * The note open in the inspector. Its layer shows whatever the playhead says
   * (so a cover can be composed without scrubbing), and its pin is the only
   * draggable one.
   */
  selectedId?: string | null
  /** View-only (share links, foreign tracks): draw the layer, never edit it. */
  readOnly?: boolean
  /** Commit a dragged pin's new position, as 0–1 fractions of the frame. */
  onMovePin?: (id: string, x: number, y: number) => void
}

/** One nudge of the arrow keys, as a fraction of the frame (Shift = ×5). */
const NUDGE = 0.01

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * The note stage layer, drawn inside the video frame (PlayerPane's `overlay`
 * slot, beneath the transport): a full-frame cover image standing in for the
 * picture, and captioned pins sitting on top of it.
 *
 * Inert by default — `pointer-events-none` throughout, so clicking the picture
 * still reaches the player's own click-to-pause catcher underneath. Only the
 * selected note's pin takes the pointer, and only when editing is allowed.
 */
export default function VideoOverlays({
  annotations,
  currentTime,
  selectedId,
  readOnly,
  onMovePin,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null)
  // Live position while a pin is under the pointer. Held locally rather than
  // written through on every move: a drag would otherwise push a project save
  // (and an undo entry) per pointer event. Committed once, on release.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
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
  const editable = !readOnly && !!onMovePin

  const posOf = (a: Annotation) =>
    drag?.id === a.id
      ? { x: drag.x, y: drag.y }
      : { x: a.overlay?.pinX ?? 0.5, y: a.overlay?.pinY ?? 0.5 }

  const fractionAt = (clientX: number, clientY: number) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: clamp01((clientX - box.left) / box.width),
      y: clamp01((clientY - box.top) / box.height),
    }
  }

  const startDrag = (a: Annotation) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!editable || a.id !== selectedId) return
    e.preventDefault()
    e.stopPropagation()
    try {
      // Capture keeps the drag alive when the pointer leaves the dot — the
      // whole point, since aiming a pin means moving away from it.
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore — the drag still tracks while the pointer is over the dot */
    }
    const at = fractionAt(e.clientX, e.clientY)
    setDrag({ id: a.id, ...(at ?? posOf(a)) })
  }

  const moveDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    const at = fractionAt(e.clientX, e.clientY)
    if (at) setDrag({ id: drag.id, ...at })
  }

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    onMovePin?.(drag.id, drag.x, drag.y)
    setDrag(null)
  }

  const nudge = (a: Annotation) => (e: ReactKeyboardEvent) => {
    if (!editable || a.id !== selectedId) return
    const step = e.shiftKey ? NUDGE * 5 : NUDGE
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
      e.key
    ]
    if (!d) return
    e.preventDefault()
    const { x, y } = posOf(a)
    onMovePin?.(a.id, clamp01(x + d[0]), clamp01(y + d[1]))
  }

  if (!cover && pins.length === 0) return null

  return (
    <div
      ref={frameRef}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {cover && (
        <img
          // Re-keyed per image so swapping a cover (or crossing from one note's
          // to another's) replays the fade instead of hard-cutting.
          key={`${cover.id}:${cover.overlay?.coverUrl}`}
          src={coverUrl}
          alt=""
          draggable={false}
          onError={() =>
            setBroken((prev) =>
              coverUrl && !prev.has(coverUrl) ? new Set(prev).add(coverUrl) : prev,
            )
          }
          className={`absolute inset-0 h-full w-full animate-fade-in bg-black ${
            cover.overlay?.coverFit === 'cover' ? 'object-cover' : 'object-contain'
          }`}
        />
      )}

      {pins.map((a) => {
        const { x, y } = posOf(a)
        const hue = a.color ?? colorForId(a.id)
        const caption = pinCaption(a)
        const armed = editable && a.id === selectedId
        // The bubble opens away from the nearer edge and is capped at the
        // distance to the far one, so a long caption wraps inside the frame
        // instead of running off the picture. Both are percentages of the
        // frame — which is why the bubble is a sibling of the dot rather than
        // its child: a percentage needs the frame as its containing block.
        const flipX = x > 0.55
        const flipY = y > 0.72
        const pct = (n: number) => `${n * 100}%`
        return (
          <div key={a.id} className="contents">
            <div
              role={armed ? 'button' : undefined}
              tabIndex={armed ? 0 : undefined}
              aria-label={
                armed ? 'Drag to move this pin, or nudge it with the arrow keys' : undefined
              }
              title={armed ? 'Drag to move — arrow keys nudge, Shift for bigger steps' : undefined}
              onPointerDown={startDrag(a)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={nudge(a)}
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
              <div
                style={{
                  left: flipX ? undefined : `calc(${pct(x)} + 14px)`,
                  right: flipX ? `calc(${pct(1 - x)} + 14px)` : undefined,
                  top: flipY ? undefined : `calc(${pct(y)} - 4px)`,
                  bottom: flipY ? `calc(${pct(1 - y)} - 4px)` : undefined,
                  maxWidth: `calc(${pct(flipX ? x : 1 - x)} - 22px)`,
                  [flipX ? 'borderRight' : 'borderLeft']: `2px solid ${hue}`,
                }}
                className="absolute w-max animate-fade-in rounded-md bg-black/70 px-2.5 py-1.5 text-[12.5px] leading-snug text-white/95 backdrop-blur-sm"
              >
                {caption ? (
                  // One line of the note is a caption; a paragraph is a wall of
                  // text over the picture. Clamp and let the note itself carry
                  // the rest.
                  <span className="line-clamp-3 block">{caption}</span>
                ) : (
                  <span className="text-white/50">
                    Type the note&rsquo;s text to caption this pin
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
