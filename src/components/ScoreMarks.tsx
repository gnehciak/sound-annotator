import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ScoreMark, ScoreMarkKind } from '../types'
import {
  DEFAULT_MARK_WEIGHT,
  INK_MIN_STEP,
  MIN_MARK,
  handlesOf,
  inkBounds,
  markAt,
  moveMark,
  resizeMark,
  type MarkHandle,
} from '../lib/score'
import { newId } from '../lib/ids'

/**
 * What the toolbar has selected. `null` is the reading state — no tool, no
 * pointer handling at all, so the page scrolls and the pins take their own
 * clicks. 'select' is the state where marks can be picked up and deleted.
 */
export type MarkTool = ScoreMarkKind | 'select' | null

export interface MarkStyle {
  color: string
  weight: number
}

interface Props {
  /** The marks on the page being drawn — the caller filters by page. */
  marks: ScoreMark[]
  /** The page these marks belong to; stamped onto anything drawn here. */
  page: number
  /** The drawn page's pixel size, so shapes keep their proportions. */
  size: { width: number; height: number }
  tool: MarkTool
  style: MarkStyle
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Commit one mark — a new one, or an existing one moved. */
  onCommit: (mark: ScoreMark) => void
}

/**
 * The marks drawn on a page of the score, and the surface that draws them.
 *
 * Every stored coordinate is a fraction of the page (see ScoreMark), and this
 * is the only place that converts: fractions in, pixels out through `size`.
 * That is what keeps a highlight over the same bar when the panel is resized,
 * the fit is switched or the score is expanded to the whole screen — the page
 * box changes, the numbers don't, and there is no arithmetic to keep in step.
 *
 * Pixels rather than an SVG `viewBox` of 0→1 with a non-uniform scale: a
 * scaled viewBox would stretch every circle into an ellipse and every stroke
 * into a different width along each axis. The page's aspect ratio is not ours
 * to distort.
 *
 * The surface takes the pointer only while a tool is chosen. With no tool it
 * is inert, so the page underneath scrolls and a note's pin still catches its
 * own drag — the reading state has to feel like nothing is in front of the
 * music.
 */
export default function ScoreMarks({
  marks,
  page,
  size,
  tool,
  style,
  selectedId,
  onSelect,
  onCommit,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  // The mark being drawn right now, or the offset of one being dragged. Held
  // locally and committed on release: writing through on every pointer move
  // would push a project save — and an undo entry — per frame of a stroke.
  const [draft, setDraft] = useState<ScoreMark | null>(null)
  const [drag, setDrag] = useState<{
    id: string
    from: { x: number; y: number }
    to: { x: number; y: number }
  } | null>(null)
  // A grip being dragged, and the mark as it looks under it. Same deal as a
  // move: local until release, one undo step for the whole gesture.
  const [sizing, setSizing] = useState<{ handle: MarkHandle; mark: ScoreMark } | null>(
    null,
  )
  // What the pointer is over with the select tool in hand, so the cursor can
  // say what a press would do before it is pressed.
  const [hover, setHover] = useState<'mark' | MarkHandle | null>(null)

  const selected = marks.find((m) => m.id === selectedId) ?? null
  // The grips, in fractions. A grip is caught by a box in *pixels* — the same
  // few pixels either way whatever the page's aspect ratio — so the tolerance
  // is converted per axis rather than being one fraction for both.
  const grips = selectedId && tool === 'select' && selected ? handlesOf(selected) : []
  const gripAt = (x: number, y: number): MarkHandle | null => {
    const padX = GRIP_HIT_PX / Math.max(1, size.width)
    const padY = GRIP_HIT_PX / Math.max(1, size.height)
    for (const g of grips)
      if (Math.abs(x - g.x) <= padX && Math.abs(y - g.y) <= padY) return g.id
    return null
  }

  const fractionAt = (e: ReactPointerEvent) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: clamp01((e.clientX - box.left) / box.width),
      y: clamp01((e.clientY - box.top) / box.height),
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!tool || e.button !== 0) return
    const at = fractionAt(e)
    if (!at) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the gesture still tracks while the pointer is over the surface */
    }

    if (tool === 'select') {
      // A grip first: it sits on the mark's own edge, so hit-testing the mark
      // first would swallow every resize as a move.
      const grip = selected && gripAt(at.x, at.y)
      if (grip && selected) {
        setSizing({ handle: grip, mark: selected })
        return
      }
      const hit = markAt(marks, at.x, at.y)
      onSelect(hit?.id ?? null)
      if (hit) setDrag({ id: hit.id, from: at, to: at })
      return
    }

    setDraft({
      id: newId(),
      page,
      kind: tool,
      color: style.color,
      weight: style.weight,
      x: at.x,
      y: at.y,
      w: 0,
      h: 0,
      ...(tool === 'ink' ? { points: [at.x, at.y] } : {}),
    })
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (!draft && !drag && !sizing) {
      // Nothing in progress: report what is under the pointer so the cursor
      // can promise the gesture. Only the select tool has anything to say —
      // the drawing tools are a crosshair everywhere.
      if (tool !== 'select') return
      const at = fractionAt(e)
      if (!at) return
      setHover(gripAt(at.x, at.y) ?? (markAt(marks, at.x, at.y) ? 'mark' : null))
      return
    }
    const at = fractionAt(e)
    if (!at) return
    if (sizing) {
      setSizing({ ...sizing, mark: resizeMark(sizing.mark, sizing.handle, at.x, at.y) })
      return
    }
    if (drag) {
      setDrag({ ...drag, to: at })
      return
    }
    if (!draft) return
    if (draft.kind === 'ink') {
      const points = draft.points ?? []
      const lastX = points[points.length - 2]
      const lastY = points[points.length - 1]
      // Drop samples too close to the previous one to tell apart once drawn.
      // A careful line emits hundreds a frame apart, and every one of them
      // would be persisted in the project's jsonb on every save from here on.
      if (Math.hypot(at.x - lastX, at.y - lastY) < INK_MIN_STEP) return
      const next = [...points, at.x, at.y]
      setDraft({ ...draft, points: next, ...inkBounds(next) })
      return
    }
    setDraft({ ...draft, w: at.x - draft.x, h: at.y - draft.y })
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (sizing) {
      const { mark } = sizing
      setSizing(null)
      // A grip pressed and released without travelling is not a resize, and a
      // shape dragged inside out to nothing is a shape nobody can catch again.
      const tiny =
        mark.kind !== 'arrow' &&
        Math.abs(mark.w) < MIN_MARK &&
        Math.abs(mark.h) < MIN_MARK
      const same =
        selected &&
        mark.x === selected.x &&
        mark.y === selected.y &&
        mark.w === selected.w &&
        mark.h === selected.h
      if (!tiny && !same) onCommit(mark)
      return
    }
    if (drag) {
      const mark = marks.find((m) => m.id === drag.id)
      const dx = drag.to.x - drag.from.x
      const dy = drag.to.y - drag.from.y
      setDrag(null)
      // A click that selected a mark is a drag of zero length; committing it
      // would spend an undo entry on having touched nothing.
      if (mark && (dx !== 0 || dy !== 0)) onCommit(moveMark(mark, dx, dy))
      return
    }
    if (!draft) return
    setDraft(null)
    // Too small to have been meant: a stray click on the page while a tool is
    // armed shouldn't leave an invisible speck behind to be found later.
    const tiny =
      draft.kind === 'ink'
        ? (draft.points?.length ?? 0) < 4
        : Math.abs(draft.w) < 0.01 && Math.abs(draft.h) < 0.01
    if (tiny) return
    const made = draft.kind === 'ink' ? draft : normalize(draft)
    onCommit(made)
    // Leave what was just drawn selected. The pen stays in your hand — a
    // teacher marking a page draws several — but the thing you have this
    // second is the thing you most likely want to recolour or take off again,
    // and having to arm the arrow and go back and find it is the long way to
    // "no, not like that".
    onSelect(made.id)
  }

  const dragOffset =
    drag && (drag.to.x !== drag.from.x || drag.to.y !== drag.from.y)
      ? { dx: drag.to.x - drag.from.x, dy: drag.to.y - drag.from.y }
      : null

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute inset-0 ${
        tool
          ? `pointer-events-auto touch-none ${
              tool === 'select' ? selectCursor(sizing?.handle ?? hover) : 'cursor-crosshair'
            }`
          : 'pointer-events-none'
      }`}
    >
      <svg
        width={size.width}
        height={size.height}
        viewBox={`0 0 ${size.width} ${size.height}`}
        className="absolute inset-0 overflow-visible"
        aria-hidden
      >
        {/* In list order, which *is* z-order: later is nearer the reader.
            That is what `markAt` walks backwards through, and what the
            bring-to-front and send-to-back verbs rewrite. */}
        {marks.map((m) => (
          <Mark
            key={m.id}
            mark={
              sizing && m.id === selectedId
                ? sizing.mark
                : dragOffset && m.id === drag?.id
                  ? moveMark(m, dragOffset.dx, dragOffset.dy)
                  : m
            }
            size={size}
            selected={m.id === selectedId}
          />
        ))}
        {draft && <Mark mark={draft} size={size} selected={false} />}

        {/* The grips, drawn last so they sit over every mark — including the
            one they belong to, whose own outline they straddle. */}
        {(sizing ? handlesOf(sizing.mark) : grips).map((g) => (
          <rect
            key={g.id}
            x={g.x * size.width - GRIP_PX / 2}
            y={g.y * size.height - GRIP_PX / 2}
            width={GRIP_PX}
            height={GRIP_PX}
            rx={2}
            fill="#fff"
            stroke={selected?.color ?? '#000'}
            strokeWidth={1.5}
          />
        ))}
      </svg>
    </div>
  )
}

/** A box dragged right-to-left or bottom-to-top, turned the right way round. */
function normalize(m: ScoreMark): ScoreMark {
  // Not for arrows: theirs is a direction, not a corner, and squaring it up
  // would swing every arrow round to point down and to the right.
  if (m.kind === 'arrow') return m
  return {
    ...m,
    x: Math.min(m.x, m.x + m.w),
    y: Math.min(m.y, m.y + m.h),
    w: Math.abs(m.w),
    h: Math.abs(m.h),
  }
}

/** One mark, in the page's own pixels. */
function Mark({
  mark,
  size,
  selected,
}: {
  mark: ScoreMark
  size: { width: number; height: number }
  selected: boolean
}) {
  // Stroke weight is scaled off the page's width so a mark drawn on a page
  // fitted to a narrow panel doesn't turn into a smear when the same page is
  // expanded to the whole screen. The floor keeps a fine line visible at all.
  const stroke = Math.max(
    1.25,
    ((mark.weight ?? DEFAULT_MARK_WEIGHT) * size.width) / 620,
  )
  const x = mark.x * size.width
  const y = mark.y * size.height
  const w = mark.w * size.width
  const h = mark.h * size.height
  const common = {
    stroke: mark.color,
    strokeWidth: stroke,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  const shape = () => {
    switch (mark.kind) {
      case 'highlight':
        return (
          <rect
            x={x}
            y={y}
            width={Math.abs(w)}
            height={Math.abs(h)}
            fill={mark.color}
            // Multiply keeps the printed staves legible through the wash,
            // which is the whole difference between a highlighter and paint.
            style={{ mixBlendMode: 'multiply' }}
            opacity={0.34}
            rx={2}
          />
        )
      case 'box':
        return (
          <rect
            x={x}
            y={y}
            width={Math.abs(w)}
            height={Math.abs(h)}
            rx={3}
            {...common}
          />
        )
      case 'ellipse':
        return (
          <ellipse
            cx={x + w / 2}
            cy={y + h / 2}
            rx={Math.abs(w) / 2}
            ry={Math.abs(h) / 2}
            {...common}
          />
        )
      case 'arrow':
        return <Arrow x={x} y={y} w={w} h={h} stroke={stroke} color={mark.color} />
      case 'ink':
        return (
          <polyline
            points={pointsToPixels(mark.points ?? [], size)}
            {...common}
          />
        )
    }
  }

  return (
    <g>
      {shape()}
      {selected && (
        <rect
          x={Math.min(x, x + w) - 5}
          y={Math.min(y, y + h) - 5}
          width={Math.abs(w) + 10}
          height={Math.abs(h) + 10}
          rx={4}
          fill="none"
          stroke={mark.color}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.9}
        />
      )}
    </g>
  )
}

/** Tail at (x, y), head at (x + w, y + h), with a head that scales sanely. */
function Arrow({
  x,
  y,
  w,
  h,
  stroke,
  color,
}: {
  x: number
  y: number
  w: number
  h: number
  stroke: number
  color: string
}) {
  const length = Math.hypot(w, h)
  if (length < 1) return null
  // Cap the head against the shaft: on a short arrow a fixed head is the
  // whole arrow, and on a long one it disappears.
  const head = Math.min(stroke * 4.5, length * 0.4)
  const angle = Math.atan2(h, w)
  const wing = (spread: number) => [
    x + w - head * Math.cos(angle - spread),
    y + h - head * Math.sin(angle - spread),
  ]
  const [ax, ay] = wing(0.42)
  const [bx, by] = wing(-0.42)
  return (
    <g stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none">
      <line x1={x} y1={y} x2={x + w} y2={y + h} />
      <polyline
        points={`${ax},${ay} ${x + w},${y + h} ${bx},${by}`}
        strokeLinejoin="round"
      />
    </g>
  )
}

function pointsToPixels(
  points: number[],
  size: { width: number; height: number },
): string {
  const out: string[] = []
  for (let i = 0; i + 1 < points.length; i += 2)
    out.push(`${points[i] * size.width},${points[i + 1] * size.height}`)
  return out.join(' ')
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** How big a grip is drawn, and how close the pointer has to get to catch it. */
const GRIP_PX = 8
const GRIP_HIT_PX = 9

/** What the select tool's cursor promises for what is under it. */
function selectCursor(over: 'mark' | MarkHandle | null): string {
  switch (over) {
    case 'nw':
    case 'se':
      return 'cursor-nwse-resize'
    case 'ne':
    case 'sw':
      return 'cursor-nesw-resize'
    case 'tail':
    case 'head':
      return 'cursor-grab'
    case 'mark':
      return 'cursor-move'
    default:
      return 'cursor-default'
  }
}
