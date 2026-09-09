import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { Quote } from 'lucide-react'

import { hueText } from '../lib/noteColors'
import { clampQuote, MIN_QUOTE } from '../lib/overlays'
import type { NoteQuote } from '../types'

interface Props {
  /** The rectangle, as 0–1 fractions of the page box this fills. */
  quote: NoteQuote
  /** The note's hue — the frame is the note's, like its pin and its row. */
  color: string
  /** View-only (share links, foreign tracks): draw the frame, never move it. */
  readOnly?: boolean
  /** Commit a moved or resized rectangle, in the same fractions. */
  onChange?: (quote: NoteQuote) => void
  /**
   * Play the track from the note this quote belongs to. Present wherever the
   * score is being *read* — the rectangle is a region of music, so the honest
   * thing for a press on it to do is play that music.
   */
  onPlay?: () => void
  /** The note's own timecode, for the tooltip and the accessible name. */
  label?: string
}

/** One nudge of the arrow keys, as a fraction of the page (Shift = ×5). */
const NUDGE = 0.01

/**
 * How far a press may travel and still count as a click, in px. The same rule
 * the pin key follows: a rectangle you are aiming is dragged, and a rectangle
 * you merely pressed is one you wanted to hear.
 */
const DRAG_SLOP = 4

/** The four corners: which edges each moves, and where it sits. */
const CORNERS = [
  { id: 'nw', sx: -1, sy: -1, at: 'left-0 top-0', cursor: 'nwse-resize' },
  { id: 'ne', sx: 1, sy: -1, at: 'left-full top-0', cursor: 'nesw-resize' },
  { id: 'sw', sx: -1, sy: 1, at: 'left-0 top-full', cursor: 'nesw-resize' },
  { id: 'se', sx: 1, sy: 1, at: 'left-full top-full', cursor: 'nwse-resize' },
] as const

interface Grab {
  /** 0 for an edge the drag leaves alone; ±1 for one it moves. */
  sx: -1 | 0 | 1
  sy: -1 | 0 | 1
  /** True when the whole rectangle travels rather than one corner. */
  whole: boolean
  startX: number
  startY: number
  from: NoteQuote
}

/**
 * The **score quote's** rectangle, drawn as fractions of the page box it fills
 * (ScoreLayer), exactly like PinLayer and for the same reason: the box is what
 * resizes, and these numbers never do.
 *
 * What it frames is the picture the note carries — onto its row in the list,
 * into the inspector, and into the printed documents (lib/quotePreview,
 * lib/quoteImages). So it is drawn as an *aiming* tool rather than as stage
 * furniture — a hairline and four corners, no fill, nothing that hides the
 * music being aimed at — and it shows only for the note open in the inspector.
 * A framed region the class is meant to see is a mark (ScoreMarks), a
 * different object with a different job; keeping quotes off the stage is what
 * stops the two from looking alike.
 *
 * The body drags the rectangle and the four corners resize it, both committed
 * once on release, so a drag is one save and one undo step rather than one per
 * pointer event. A press that never travels `DRAG_SLOP` isn't a drag at all:
 * it plays the note, because a region of the music is a thing you want to
 * hear, and that is the whole gesture where the frame is read-only.
 */
export default function QuoteFrame({
  quote,
  color,
  readOnly,
  onChange,
  onPlay,
  label,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  // The rectangle under the pointer, held locally for the length of the drag.
  const [draft, setDraft] = useState<NoteQuote | null>(null)
  const grab = useRef<Grab | null>(null)
  // Whether the press on the body has travelled far enough to be a drag. A
  // press that never does is a click, and plays the note — so an editor gets
  // both gestures on one rectangle without a second control to hit.
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const editable = !readOnly && !!onChange
  // Anything the pointer or the keyboard can reach: the rectangle is a button
  // wherever it plays, and a draggable one where it is also being aimed.
  const interactive = editable || !!onPlay

  const q = draft ?? quote
  // The page is white paper in both themes, so the hue is resolved for one.
  const hue = hueText(color, 'light')

  // Takes the event first rather than returning a handler, so nothing here is
  // *called* during render — a factory invoked in the JSX would put this ref
  // write in the render phase as far as the compiler is concerned.
  const begin = (
    e: ReactPointerEvent<HTMLElement>,
    whole: boolean,
    sx: -1 | 0 | 1,
    sy: -1 | 0 | 1,
  ) => {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the drag still tracks while the pointer is over the element */
    }
    grab.current = { whole, sx, sy, startX: e.clientX, startY: e.clientY, from: quote }
    // Only the body's press can turn out to be a click: a corner is a handle,
    // and pressing one is never a request to hear anything.
    press.current = whole ? { x: e.clientX, y: e.clientY, moved: false } : null
    setDraft(quote)
  }

  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const g = grab.current
    const box = boxRef.current?.getBoundingClientRect()
    if (!g || !box || box.width === 0 || box.height === 0) return
    const p = press.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= DRAG_SLOP) p.moved = true
    const dx = (e.clientX - g.startX) / box.width
    const dy = (e.clientY - g.startY) / box.height
    if (g.whole) {
      setDraft(clampQuote({ ...g.from, x: g.from.x + dx, y: g.from.y + dy }))
      return
    }
    // Resizing moves the grabbed corner and leaves the opposite one where it
    // is, so the two edges the pointer isn't touching stay put.
    const { from } = g
    const left = g.sx < 0 ? from.x + dx : from.x
    const right = g.sx > 0 ? from.x + from.w + dx : from.x + from.w
    const top = g.sy < 0 ? from.y + dy : from.y
    const bottom = g.sy > 0 ? from.y + from.h + dy : from.y + from.h
    setDraft(
      clampQuote({
        ...from,
        x: Math.min(left, right - MIN_QUOTE),
        y: Math.min(top, bottom - MIN_QUOTE),
        w: Math.max(MIN_QUOTE, right - left),
        h: Math.max(MIN_QUOTE, bottom - top),
      }),
    )
  }

  const end = () => {
    const next = draft
    const clicked = !!press.current && !press.current.moved
    grab.current = null
    press.current = null
    setDraft(null)
    // A press that stayed put is a click, and the sub-slop wobble under it is
    // not a move anyone asked for — so it plays the note and commits nothing.
    if (clicked) {
      onPlay?.()
      return
    }
    if (next) onChange?.(next)
  }

  // The arrows move the rectangle; the corners are the only way to resize it.
  // One meaning per key beats overloading Shift, which is already the big step.
  // Enter and Space are the click, since this is a button to the keyboard.
  const nudge = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (onPlay && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onPlay()
      return
    }
    if (!editable) return
    const by = e.shiftKey ? NUDGE * 5 : NUDGE
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-by, 0],
      ArrowRight: [by, 0],
      ArrowUp: [0, -by],
      ArrowDown: [0, by],
    }
    const d = step[e.key]
    if (!d) return
    e.preventDefault()
    onChange?.(clampQuote({ ...quote, x: quote.x + d[0], y: quote.y + d[1] }))
  }

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0">
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          editable
            ? 'Move the score quote, or press it to play the note'
            : onPlay
              ? `Play from ${label ?? 'this score quote'}`
              : undefined
        }
        title={onPlay && label ? `Play from ${label}` : undefined}
        onPointerDown={(e) => begin(e, true, 0, 0)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        // Reading, there is no press to interpret: the rectangle is inert
        // except as a button, so the browser's own click is the whole gesture
        // — and a touch that scrolled the page never produces one.
        onClick={editable ? undefined : onPlay}
        onKeyDown={nudge}
        style={{
          left: `${q.x * 100}%`,
          top: `${q.y * 100}%`,
          width: `${q.w * 100}%`,
          height: `${q.h * 100}%`,
          // A hairline in the note's hue: enough to read as an aimed
          // rectangle, not enough to compete with the engraving inside it.
          boxShadow: `inset 0 0 0 1.5px ${hue}`,
        }}
        className={`absolute animate-fade-in rounded-[3px] ${
          interactive
            ? 'pointer-events-auto outline-none focus-visible:ring-2 focus-visible:ring-accent'
            : ''
        } ${editable ? 'cursor-move touch-none' : onPlay ? 'cursor-pointer' : ''}`}
      >
        {/* A badge, not a caption: what the rectangle *is* needs saying once,
            and its words are the note's own, printed underneath it. Centred on
            the top edge like a fieldset's legend — the corners are where the
            handles are, and the middle of an edge is the one place a label
            can sit without covering one. */}
        <span
          style={{ background: hue, color: '#fff' }}
          className="pointer-events-none absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-[3px] px-1 py-[3px] text-[8px] font-semibold uppercase leading-none tracking-[0.14em]"
        >
          <Quote size={8} strokeWidth={2.5} />
          Quote
        </span>

        {editable &&
          CORNERS.map((c) => (
            <span
              key={c.id}
              role="presentation"
              onPointerDown={(e) => begin(e, false, c.sx, c.sy)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              style={{ background: hue, cursor: c.cursor }}
              className={`pointer-events-auto absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 touch-none rounded-[2px] ring-1 ring-white/70 ${c.at}`}
            />
          ))}
      </div>
    </div>
  )
}
