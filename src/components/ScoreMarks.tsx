import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ScoreMark, ScoreMarkKind } from '../types'
import {
  HIGHLIGHT_OPACITY,
  INK_MIN_STEP,
  MAX_MARK_TEXT,
  MIN_MARK,
  TEXT_ASCENT,
  TEXT_FONT,
  TEXT_LEADING,
  arrowWings,
  handlesOf,
  inkBounds,
  markAt,
  marksInRect,
  measureText,
  moveMark,
  resizeMark,
  snapAngle,
  squareCorner,
  strokeOf,
  textSizeOf,
  type MarkHandle,
} from '../lib/score'
import { hueText } from '../lib/noteColors'
import { newId } from '../lib/ids'

/**
 * What the toolbar has selected. `null` is the reading state — no tool, no
 * pointer handling at all, so the page scrolls and the pins take their own
 * clicks. 'select' is the state where marks can be picked up and deleted, and
 * 'eraser' takes off whatever it is dragged across.
 */
export type MarkTool = ScoreMarkKind | 'select' | 'eraser' | null

export interface MarkStyle {
  color: string
  weight: number
}

interface Props {
  /** The marks on the page being drawn — the caller filters by page. */
  marks: ScoreMark[]
  /**
   * Marks drawn beneath these that this surface may not touch: the track's
   * own, under a reader's private layer (lib/personalMarks). Never selectable,
   * never erased — the reader sees what the teacher drew, and draws over it.
   */
  underlay?: ScoreMark[]
  /** The page these marks belong to; stamped onto anything drawn here. */
  page: number
  /** The drawn page's pixel size, so shapes keep their proportions. */
  size: { width: number; height: number }
  tool: MarkTool
  style: MarkStyle
  /** What is selected — anywhere in the score, not only on this page. */
  selectedIds: string[]
  onSelect: (ids: string[]) => void
  /** Commit marks — new ones, or existing ones moved, resized or retyped. One
   *  call is one save and one undo step, however many marks it carries. */
  onCommit: (marks: ScoreMark[]) => void
  /** Take marks off — the eraser's sweep, or text emptied of its words. */
  onErase: (ids: string[]) => void
}

/** A gesture in progress, held locally and committed once, on release. */
type Gesture =
  | { kind: 'draw'; draft: ScoreMark; from: { x: number; y: number } }
  | { kind: 'move'; ids: string[]; from: { x: number; y: number }; to: { x: number; y: number } }
  | { kind: 'size'; handle: MarkHandle; mark: ScoreMark }
  | { kind: 'marquee'; from: { x: number; y: number }; to: { x: number; y: number }; add: boolean }
  | { kind: 'erase'; ids: string[] }

/** Words being typed onto the page — a new text mark, or one being retyped. */
interface Typing {
  /** The mark being retyped, or absent for a new one. */
  mark?: ScoreMark
  x: number
  y: number
  text: string
  color: string
  weight: number
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
 *
 * Every gesture is held locally and committed once, on release: writing
 * through on every pointer move would push a project save — and an undo
 * entry — per frame of a stroke.
 */
export default function ScoreMarks({
  marks,
  underlay,
  page,
  size,
  tool,
  style,
  selectedIds,
  onSelect,
  onCommit,
  onErase,
}: Props) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [typing, setTyping] = useState<Typing | null>(null)
  // What the pointer is over with the select tool in hand, so the cursor can
  // say what a press would do before it is pressed.
  const [hover, setHover] = useState<'mark' | MarkHandle | null>(null)
  // Fingers on the page. A second one means the reader wants to pinch or
  // pan, not to draw: whatever the first started is dropped, and the surface
  // stands aside until they are all lifted (see ScoreSurface's two-finger
  // gesture, which listens in the capture phase so it sees them either way).
  const touches = useRef(new Set<number>())
  const [yielded, setYielded] = useState(false)

  const selected = new Set(selectedIds)
  const onlySelected =
    selectedIds.length === 1 ? (marks.find((m) => m.id === selectedIds[0]) ?? null) : null
  // Grips only on a lone selection: resizing three marks from one corner is a
  // question with no good answer, and grips on each would be a field of them.
  const grips = tool === 'select' && onlySelected ? handlesOf(onlySelected) : []
  const gripAt = (x: number, y: number): MarkHandle | null => {
    // Caught by a box in *pixels* — the same few either way whatever the
    // page's aspect ratio — so the tolerance is converted per axis.
    const padX = GRIP_HIT_PX / Math.max(1, size.width)
    const padY = GRIP_HIT_PX / Math.max(1, size.height)
    for (const g of grips)
      if (Math.abs(x - g.x) <= padX && Math.abs(y - g.y) <= padY) return g.id
    return null
  }

  const fractionAt = (e: { clientX: number; clientY: number }) => {
    const box = boxRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: clamp01((e.clientX - box.left) / box.width),
      y: clamp01((e.clientY - box.top) / box.height),
    }
  }

  // ---- text ----------------------------------------------------------------

  // The edit already dealt with. Setting the words unmounts the text box, and
  // its blur then asks to set them again from the same closure — without this
  // an Enter would commit the words twice, and an Escape would commit what it
  // was pressed to throw away.
  const settled = useRef<Typing | null>(null)

  const commitTyping = (t: Typing | null = typing) => {
    setTyping(null)
    if (!t || settled.current === t) return
    settled.current = t
    const text = t.text.replace(/\s+$/, '').slice(0, MAX_MARK_TEXT)
    // Emptied of its words, a text mark is nothing — take it off rather than
    // leave an invisible box to be tripped over.
    if (!text.trim()) {
      if (t.mark) onErase([t.mark.id])
      return
    }
    if (t.mark && t.mark.text === text) return
    const box = measureText(text, t.weight, size)
    const mark: ScoreMark = {
      ...(t.mark ?? { id: newId(), page, kind: 'text' as const }),
      color: t.color,
      weight: t.weight,
      x: t.x,
      y: t.y,
      w: box.w,
      h: box.h,
      text,
    }
    onCommit([mark])
    onSelect([mark.id])
  }

  const onTypingKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sets the words, Shift+Enter breaks the line — the chat-box rule
    // everyone already has in their fingers. Escape throws the edit away.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitTyping()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      settled.current = typing
      setTyping(null)
    }
  }

  // ---- the pointer ---------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'touch') {
      touches.current.add(e.pointerId)
      if (touches.current.size > 1) {
        // The second finger: this was never a stroke. Drop it and let the
        // score's own two-finger gesture have the page.
        setGesture(null)
        setYielded(true)
        return
      }
    }
    if (!tool || e.button !== 0 || yielded) return
    const at = fractionAt(e)
    if (!at) return
    // A press anywhere else sets the words being typed, the way clicking out
    // of any text box does.
    if (typing) {
      commitTyping()
      if (tool === 'text') return
    }
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
      const grip = onlySelected && !e.shiftKey ? gripAt(at.x, at.y) : null
      if (grip && onlySelected) {
        setGesture({ kind: 'size', handle: grip, mark: onlySelected })
        return
      }
      const hit = markAt(marks, at.x, at.y)
      if (hit && e.shiftKey) {
        // Shift toggles one mark in or out and moves nothing.
        onSelect(selected.has(hit.id) ? selectedIds.filter((id) => id !== hit.id) : [...selectedIds, hit.id])
        return
      }
      if (hit) {
        // Pressing a mark that is already part of the selection moves the
        // whole selection; pressing any other mark makes it the selection.
        const ids = selected.has(hit.id) ? selectedIds : [hit.id]
        if (!selected.has(hit.id)) onSelect(ids)
        setGesture({ kind: 'move', ids, from: at, to: at })
        return
      }
      // Empty page: a marquee. With Shift it adds to what is selected.
      setGesture({ kind: 'marquee', from: at, to: at, add: e.shiftKey })
      return
    }

    if (tool === 'eraser') {
      const hit = markAt(marks, at.x, at.y)
      setGesture({ kind: 'erase', ids: hit ? [hit.id] : [] })
      return
    }

    if (tool === 'text') {
      setTyping({ x: at.x, y: at.y, text: '', color: style.color, weight: style.weight })
      return
    }

    setGesture({
      kind: 'draw',
      from: at,
      draft: {
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
      },
    })
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const at = fractionAt(e)
    if (!at) return
    if (!gesture) {
      // Nothing in progress: report what is under the pointer so the cursor
      // can promise the gesture. Only the select tool has anything to say.
      if (tool === 'select')
        setHover(gripAt(at.x, at.y) ?? (markAt(marks, at.x, at.y) ? 'mark' : null))
      return
    }
    switch (gesture.kind) {
      case 'size':
        setGesture({ ...gesture, mark: resizeMark(gesture.mark, gesture.handle, at.x, at.y) })
        return
      case 'move':
        setGesture({ ...gesture, to: at })
        return
      case 'marquee':
        setGesture({ ...gesture, to: at })
        return
      case 'erase': {
        const hit = markAt(marks, at.x, at.y)
        if (hit && !gesture.ids.includes(hit.id))
          setGesture({ ...gesture, ids: [...gesture.ids, hit.id] })
        return
      }
      case 'draw': {
        const { draft, from } = gesture
        if (draft.kind === 'ink') {
          const points = draft.points ?? []
          const lastX = points[points.length - 2]
          const lastY = points[points.length - 1]
          // Drop samples too close to the previous one to tell apart once
          // drawn. A careful line emits hundreds a frame apart, and every one
          // would be persisted in the project's jsonb on every save.
          if (Math.hypot(at.x - lastX, at.y - lastY) < INK_MIN_STEP) return
          const next = [...points, at.x, at.y]
          setGesture({ ...gesture, draft: { ...draft, points: next, ...inkBounds(next) } })
          return
        }
        // Shift constrains: a square, a circle, a line at a clean angle. On
        // screen, not in fractions — a page is taller than it is wide, and a
        // "square" of equal fractions is a tall rectangle.
        const to = !e.shiftKey
          ? at
          : draft.kind === 'arrow'
            ? snapAngle(from, at, size)
            : squareCorner(from, at, size)
        setGesture({ ...gesture, draft: { ...draft, w: to.x - from.x, h: to.y - from.y } })
        return
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId)
    if (touches.current.size === 0 && yielded) setYielded(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const g = gesture
    setGesture(null)
    if (!g) return
    switch (g.kind) {
      case 'size': {
        const { mark } = g
        // A grip pressed and released without travelling is not a resize,
        // and a shape dragged inside out to nothing can't be caught again.
        const tiny = mark.kind !== 'arrow' && Math.abs(mark.w) < MIN_MARK && Math.abs(mark.h) < MIN_MARK
        const was = onlySelected
        const same = was && mark.x === was.x && mark.y === was.y && mark.w === was.w && mark.h === was.h
        if (!tiny && !same) onCommit([mark])
        return
      }
      case 'move': {
        const dx = g.to.x - g.from.x
        const dy = g.to.y - g.from.y
        // A click that selected a mark is a drag of zero length; committing
        // it would spend an undo entry on having touched nothing.
        if (dx === 0 && dy === 0) return
        const moving = new Set(g.ids)
        onCommit(marks.filter((m) => moving.has(m.id)).map((m) => moveMark(m, dx, dy)))
        return
      }
      case 'marquee': {
        const r = { x: g.from.x, y: g.from.y, w: g.to.x - g.from.x, h: g.to.y - g.from.y }
        // A click on empty paper, not a drag: it clears the selection, the
        // way clicking away from anything selected always does.
        if (Math.abs(r.w) < 0.004 && Math.abs(r.h) < 0.004) {
          if (!g.add) onSelect([])
          return
        }
        const caught = marksInRect(marks, r).map((m) => m.id)
        onSelect(g.add ? [...new Set([...selectedIds, ...caught])] : caught)
        return
      }
      case 'erase':
        if (g.ids.length) onErase(g.ids)
        return
      case 'draw': {
        const { draft } = g
        // Too small to have been meant: a stray click while a tool is armed
        // shouldn't leave an invisible speck behind to be found later.
        const tiny =
          draft.kind === 'ink'
            ? (draft.points?.length ?? 0) < 4
            : Math.abs(draft.w) < 0.01 && Math.abs(draft.h) < 0.01
        if (tiny) return
        const made = draft.kind === 'ink' ? draft : normalize(draft)
        onCommit([made])
        // Leave what was just drawn selected. The pen stays in your hand, but
        // the thing you have this second is the thing you most likely want to
        // recolour or take off again.
        onSelect([made.id])
        return
      }
    }
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    // Double-click words to retype them, with whichever tool is in hand that
    // can reach them — the arrow, or the text tool itself.
    if (tool !== 'select' && tool !== 'text') return
    const at = fractionAt(e)
    const hit = at && markAt(marks, at.x, at.y)
    if (!hit || hit.kind !== 'text') return
    e.preventDefault()
    e.stopPropagation()
    setTyping({
      mark: hit,
      x: hit.x,
      y: hit.y,
      text: hit.text ?? '',
      color: hit.color,
      weight: hit.weight ?? style.weight,
    })
  }

  // What each mark looks like right now — mid-move, mid-resize, or not at all
  // while the eraser is passing over it.
  const moved =
    gesture?.kind === 'move' && (gesture.to.x !== gesture.from.x || gesture.to.y !== gesture.from.y)
      ? { ids: new Set(gesture.ids), dx: gesture.to.x - gesture.from.x, dy: gesture.to.y - gesture.from.y }
      : null
  const erasing = gesture?.kind === 'erase' ? new Set(gesture.ids) : null
  const shown = marks
    .filter((m) => !erasing?.has(m.id) && m.id !== typing?.mark?.id)
    .map((m) =>
      gesture?.kind === 'size' && m.id === gesture.mark.id
        ? gesture.mark
        : moved?.ids.has(m.id)
          ? moveMark(m, moved.dx, moved.dy)
          : m,
    )
  const marquee =
    gesture?.kind === 'marquee'
      ? {
          x: Math.min(gesture.from.x, gesture.to.x) * size.width,
          y: Math.min(gesture.from.y, gesture.to.y) * size.height,
          w: Math.abs(gesture.to.x - gesture.from.x) * size.width,
          h: Math.abs(gesture.to.y - gesture.from.y) * size.height,
        }
      : null

  const cursor =
    tool === 'select'
      ? selectCursor(gesture?.kind === 'size' ? gesture.handle : hover)
      : tool === 'eraser'
        ? ''
        : tool === 'text'
          ? 'cursor-text'
          : 'cursor-crosshair'

  return (
    <div
      ref={boxRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      style={tool === 'eraser' ? { cursor: ERASER_CURSOR } : undefined}
      className={`absolute inset-0 ${
        tool ? `pointer-events-auto touch-none ${cursor}` : 'pointer-events-none'
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
        {underlay?.map((m) => <Mark key={`u:${m.id}`} mark={m} size={size} selected={false} />)}
        {shown.map((m) => (
          <Mark key={m.id} mark={m} size={size} selected={selected.has(m.id)} />
        ))}
        {gesture?.kind === 'draw' && <Mark mark={gesture.draft} size={size} selected={false} />}

        {marquee && (
          <rect
            x={marquee.x}
            y={marquee.y}
            width={marquee.w}
            height={marquee.h}
            fill="rgba(90,168,255,0.08)"
            stroke="#5aa8ff"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}

        {/* The grips, drawn last so they sit over every mark — including the
            one they belong to, whose own outline they straddle. */}
        {(gesture?.kind === 'size' ? handlesOf(gesture.mark) : grips).map((g) => (
          <rect
            key={g.id}
            x={g.x * size.width - GRIP_PX / 2}
            y={g.y * size.height - GRIP_PX / 2}
            width={GRIP_PX}
            height={GRIP_PX}
            rx={2}
            fill="#fff"
            stroke={onlySelected?.color ?? '#000'}
            strokeWidth={1.5}
          />
        ))}
      </svg>

      {/* The words being typed: a real text box laid exactly where they will
          sit, at the size they will be, so what you type is what the page
          shows. A textarea rather than an input because a direction on a
          score is often two lines. */}
      {typing && (
        <textarea
          // Focused on mount: the press that placed it is the press that
          // means "type here".
          autoFocus
          value={typing.text}
          onChange={(e) => setTyping({ ...typing, text: e.target.value.slice(0, MAX_MARK_TEXT) })}
          onKeyDown={onTypingKey}
          onBlur={() => commitTyping()}
          onPointerDown={(e) => e.stopPropagation()}
          rows={Math.max(1, typing.text.split('\n').length)}
          placeholder="Type…"
          aria-label="Words on the score"
          style={{
            left: `${typing.x * 100}%`,
            top: `${typing.y * 100}%`,
            fontSize: textSizeOf(typing.weight) * size.width,
            lineHeight: TEXT_LEADING,
            fontFamily: TEXT_FONT,
            color: hueText(typing.color, 'light'),
            minWidth: textSizeOf(typing.weight) * size.width * 6,
            width: `${Math.max(8, longestLine(typing.text) + 2)}ch`,
          }}
          className="pointer-events-auto absolute z-10 resize-none overflow-hidden whitespace-pre rounded-[3px] border border-dashed border-[#5aa8ff] bg-white/85 p-0 outline-none"
        />
      )}
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
  const stroke = strokeOf(mark.weight, size.width)
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
            opacity={HIGHLIGHT_OPACITY}
            rx={2}
          />
        )
      case 'box':
        return <rect x={x} y={y} width={Math.abs(w)} height={Math.abs(h)} rx={3} {...common} />
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
      case 'arrow': {
        const wings = arrowWings(x, y, w, h, stroke)
        if (!wings) return null
        const [[ax, ay], [bx, by]] = wings
        return (
          <g stroke={mark.color} strokeWidth={stroke} strokeLinecap="round" fill="none">
            <line x1={x} y1={y} x2={x + w} y2={y + h} />
            <polyline points={`${ax},${ay} ${x + w},${y + h} ${bx},${by}`} strokeLinejoin="round" />
          </g>
        )
      }
      case 'ink':
        return <polyline points={pointsToPixels(mark.points ?? [], size)} {...common} />
      case 'text': {
        const px = textSizeOf(mark.weight) * size.width
        // Ink darkened until it reads on white paper: the palette is chosen to
        // survive as a stroke, and a yellow *word* would not.
        return (
          <text
            fontFamily={TEXT_FONT}
            fontSize={px}
            fill={hueText(mark.color, 'light')}
            style={{ whiteSpace: 'pre' }}
          >
            {(mark.text ?? '').split('\n').map((line, i) => (
              <tspan key={i} x={x} y={y + px * (TEXT_ASCENT + i * TEXT_LEADING)}>
                {line}
              </tspan>
            ))}
          </text>
        )
      }
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
          stroke={mark.kind === 'text' ? hueText(mark.color, 'light') : mark.color}
          strokeWidth={1}
          strokeDasharray="4 3"
          opacity={0.9}
        />
      )}
    </g>
  )
}

function pointsToPixels(points: number[], size: { width: number; height: number }): string {
  const out: string[] = []
  for (let i = 0; i + 1 < points.length; i += 2)
    out.push(`${points[i] * size.width},${points[i + 1] * size.height}`)
  return out.join(' ')
}

const longestLine = (text: string) => Math.max(...text.split('\n').map((l) => l.length))

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** How big a grip is drawn, and how close the pointer has to get to catch it. */
const GRIP_PX = 8
const GRIP_HIT_PX = 9

/**
 * The eraser's cursor: a small ring rather than a crosshair, so the reader
 * can see it is a tool that *takes off* — a crosshair promises to put down.
 */
const ERASER_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="7" fill="white" stroke="black" stroke-width="1.5"/></svg>',
)}") 10 10, cell`

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
