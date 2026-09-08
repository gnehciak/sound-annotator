import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { X } from 'lucide-react'
import type { Annotation } from '../types'
import { noteLabel } from '../lib/format'
import { colorForId, hueOnDark } from '../lib/noteColors'
import { pinCaption } from '../lib/overlays'

interface Props {
  /** The pins to draw. The caller decides which ones belong to its box. */
  pins: Annotation[]
  /** The note open in the inspector — the only one whose pin can be dragged. */
  selectedId?: string | null
  /** View-only (share links, foreign tracks): draw the pins, never move them. */
  readOnly?: boolean
  /** Commit a dragged pin, as 0–1 fractions of *this* box. */
  onMovePin?: (id: string, x: number, y: number) => void
  /**
   * What a click on a caption should do, since the card has to take the pointer
   * to be hoverable and so swallows whatever was behind it. On the video frame
   * that's the player's own click-to-pause catcher, and this hands it back;
   * on the score page there's nothing to hand back, so it's left off.
   */
  onTogglePlay?: () => void
  /**
   * Let captions size themselves against the viewport instead of this box.
   *
   * A caption is capped so it can't run off the picture, and that cap is a
   * percentage of the box the pins live in — right for the video frame, wrong
   * for a portrait score page, which can be a couple of hundred pixels wide
   * and would squeeze every caption into a column of one-word lines. The page
   * box doesn't clip, so on the score a caption is allowed to spill past the
   * page into the frame around it.
   */
  spill?: boolean
}

/** One nudge of the arrow keys, as a fraction of the box (Shift = ×5). */
const NUDGE = 0.01

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * Captioned pins, drawn as fractions of whatever box this fills.
 *
 * Every position in here is a percentage, never a pixel, which is what lets
 * the same component serve two very different boxes: the video frame (see
 * VideoOverlays), where a pin marks a place on the picture, and the drawn page
 * of a PDF score (see ScoreLayer), where it marks a place in the music and has
 * to hold that place through every rescale, refit and scroll of the page. The
 * box moves; the pin's numbers don't.
 *
 * Inert except for the selected note's dot, so a layer of pins never eats the
 * clicks meant for what's behind it.
 */
export default function PinLayer({
  pins,
  selectedId,
  readOnly,
  onMovePin,
  onTogglePlay,
  spill,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Live position while a pin is under the pointer. Held locally rather than
  // written through on every move: a drag would otherwise push a project save
  // (and an undo entry) per pointer event. Committed once, on release.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(
    null,
  )
  // Captions the viewer has closed. A dismissal is a *viewing* decision, not
  // an edit — nothing is saved, and the note is untouched — so it lives here
  // and dies with the page. It has no expiry either: a caption put away stays
  // away, because coming back on the next replay is exactly what someone who
  // just closed it doesn't want. The dot is the way back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set())
  // Whether the pointer travelled during the current press on a dot, so a
  // drag that ends on the dot isn't also read as a click.
  const dragMoved = useRef(false)
  const editable = !readOnly

  const hide = (id: string) => setHidden((prev) => new Set(prev).add(id))
  const show = (id: string) =>
    setHidden((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

  const posOf = (a: Annotation) =>
    drag?.id === a.id
      ? { x: drag.x, y: drag.y }
      : { x: a.overlay?.pinX ?? 0.5, y: a.overlay?.pinY ?? 0.5 }

  const fractionAt = (clientX: number, clientY: number) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: clamp01((clientX - box.left) / box.width),
      y: clamp01((clientY - box.top) / box.height),
    }
  }

  const startPinDrag = (a: Annotation) => (e: ReactPointerEvent<HTMLElement>) => {
    dragMoved.current = false
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
    if (!at) return
    if (at.x !== drag.x || at.y !== drag.y) dragMoved.current = true
    setDrag({ id: drag.id, ...at })
  }

  const endPinDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!drag) return
    release(e)
    onMovePin?.(drag.id, drag.x, drag.y)
    setDrag(null)
  }

  /** Arrow-key nudging — a pin needs it to reach an exact spot. */
  const nudge =
    (a: Annotation, armed: boolean, at: { x: number; y: number }) =>
    (e: ReactKeyboardEvent) => {
      const dir = ARROWS[e.key]
      if (!armed || !dir || !onMovePin) return
      e.preventDefault()
      const step = e.shiftKey ? NUDGE * 5 : NUDGE
      onMovePin(a.id, clamp01(at.x + dir[0] * step), clamp01(at.y + dir[1] * step))
    }

  if (pins.length === 0) return null

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
    {pins.map((a) => {
      const { x, y } = posOf(a)
      const hue = a.color ?? colorForId(a.id)
      // The layer is dark whatever the theme, so the hue takes the
      // dark-surface treatment even on the light page.
      const ink = hueOnDark(hue)
      const caption = pinCaption(a)
      const armed = editable && !!onMovePin && a.id === selectedId
      // Closed captions leave their dot behind, and the dot is how they come
      // back — so it takes the pointer for that alone, whether or not the note
      // is the one being edited.
      const closed = hidden.has(a.id)
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
        maxWidth: spill
          ? 'min(21rem, 40vw)'
          : `min(calc(${pct(flipX ? x : 1 - x)} - 28px), 21rem)`,
        ['--hue' as string]: ink,
      }
      return (
        <div key={a.id} className="contents">
          <div
            role={armed || closed ? 'button' : undefined}
            tabIndex={armed || closed ? 0 : undefined}
            aria-label={
              closed
                ? 'Show this note again'
                : armed
                  ? 'Drag to move this pin, or nudge it with the arrow keys'
                  : undefined
            }
            title={
              closed
                ? 'Show this note again'
                : armed
                  ? 'Drag to move — arrow keys nudge, Shift for bigger steps'
                  : undefined
            }
            onPointerDown={startPinDrag(a)}
            onPointerMove={movePinDrag}
            onPointerUp={endPinDrag}
            onPointerCancel={endPinDrag}
            // A press that never travelled is a click, even on a pin that was
            // also draggable — that's what reopens a closed caption.
            onClick={() => {
              if (closed && !dragMoved.current) show(a.id)
            }}
            onKeyDown={(e) => {
              if (closed && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                show(a.id)
                return
              }
              nudge(a, armed, { x, y })(e)
            }}
            style={{ left: pct(x), top: pct(y) }}
            className={`absolute -translate-x-1/2 -translate-y-1/2 animate-fade-in rounded-full p-2 ${
              armed
                ? 'pointer-events-auto cursor-grab touch-none active:cursor-grabbing'
                : closed
                  ? 'pointer-events-auto cursor-pointer'
                  : ''
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

          {(caption || armed) && !closed && (
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
                onClick={onTogglePlay}
                className={`on-video-pop group/pin pointer-events-auto absolute w-max animate-fade-in select-none ${
                  onTogglePlay ? 'cursor-pointer' : ''
                }`}
              >
                <span className="on-video-pop__label justify-between">
                  {noteLabel(a.start, a.end)}
                  {/* Hidden at rest, like every other secondary control here.
                      It stays in the layout so revealing it can't reflow the
                      card, and stays untouchable so the invisible target can't
                      swallow a click meant for the picture. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      hide(a.id)
                    }}
                    aria-label="Hide this note — its dot stays on the picture"
                    title="Hide this note — its dot stays"
                    className="btn-icon on-video press pointer-events-none -my-1 -mr-1 opacity-0 transition-opacity duration-150 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/pin:pointer-events-auto group-hover/pin:opacity-100"
                  >
                    <X size={13} />
                  </button>
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
