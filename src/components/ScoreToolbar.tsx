import {
  ArrowUpRight,
  BringToFront,
  Circle,
  Copy,
  Eraser,
  Highlighter,
  MousePointer2,
  PenLine,
  SendToBack,
  Square,
  Trash2,
  Type,
} from 'lucide-react'
import { useRef, useState } from 'react'
import type { ScoreMarkKind } from '../types'
import Popover from './Popover'
import { MARK_COLORS } from '../lib/score'
import type { MarkStyle, MarkTool } from './ScoreMarks'

const TOOLS: { kind: ScoreMarkKind; label: string; icon: typeof Square }[] = [
  { kind: 'highlight', label: 'Highlight', icon: Highlighter },
  { kind: 'box', label: 'Box', icon: Square },
  { kind: 'ellipse', label: 'Circle', icon: Circle },
  { kind: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { kind: 'ink', label: 'Draw', icon: PenLine },
  { kind: 'text', label: 'Text — click to type, double-click words to retype', icon: Type },
]

/** Stroke weights, as the toolbar names them. */
const WEIGHTS = [
  { value: 1, label: 'Fine', size: 'Small', dot: 2 },
  { value: 2, label: 'Medium', size: 'Medium', dot: 3.5 },
  { value: 3, label: 'Broad', size: 'Large', dot: 5 },
]

/**
 * The drawing tools, floating at the foot of the score view.
 *
 * At the foot rather than the head because the page nav already lives at the
 * top and because a hand drawing on the page comes from below it — the same
 * reason a pen tray is at the bottom of a whiteboard.
 *
 * A floating pill, unlike the page nav and the transport that bracket the
 * view: those are the panel's own furniture and belong to its edges, while
 * this is the thing in your hand. It sits over the page, only as wide as the
 * tools in it, and lets the music show either side.
 *
 * "Read" (no tool) is a first-class state, not the absence of one: with a tool
 * armed the surface takes every pointer event, so there has to be somewhere
 * obvious to put the pen down before the page can be scrolled or a pin
 * dragged. It's also where the toolbar starts.
 */
export default function ScoreToolbar({
  tool,
  onTool,
  style,
  onStyle,
  canDelete,
  selectedCount = 1,
  onDelete,
  onDuplicate,
  onRaise,
  onLower,
}: {
  tool: MarkTool
  onTool: (tool: MarkTool) => void
  style: MarkStyle
  onStyle: (style: MarkStyle) => void
  /** A mark is selected: the verbs below act on it, and the colours restyle it. */
  canDelete: boolean
  /** How many marks the verbs will act on, for their labels. */
  selectedCount?: number
  onDelete: () => void
  onDuplicate: () => void
  /** Order is z-order — see `raiseMark` / `lowerMark` in lib/score. */
  onRaise: () => void
  onLower: () => void
}) {
  const drawing = tool !== null && tool !== 'select'
  const [colorsOpen, setColorsOpen] = useState(false)
  const colorRef = useRef<HTMLButtonElement>(null)
  return (
    <div className="flex justify-center px-3">
      <div className="glass-pop pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-xl px-1.5 py-1.5">
        <ToolButton
          active={tool === 'select' || tool === null}
          label={
            tool === null
              ? 'Reading — pick a tool to draw'
              : 'Select and move marks — drag a box round several, ⇧-click to add, ⌥+arrows to nudge'
          }
          onClick={() => onTool(tool === 'select' ? null : 'select')}
        >
          <MousePointer2 size={14} />
        </ToolButton>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />

        {TOOLS.map(({ kind, label, icon: Icon }) => (
          <ToolButton
            key={kind}
            active={tool === kind}
            label={label}
            onClick={() => onTool(tool === kind ? null : kind)}
          >
            <Icon size={14} />
          </ToolButton>
        ))}
        {/* The eraser: drag across marks to take them off, the sweep one undo
            step. Select-then-delete works too, but it is two gestures for the
            thing people reach for straight after a highlighter. */}
        <ToolButton
          active={tool === 'eraser'}
          label="Eraser — drag across marks to take them off"
          onClick={() => onTool(tool === 'eraser' ? null : 'eraser')}
        >
          <Eraser size={14} />
        </ToolButton>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />

        {/* The colour is one swatch that opens the six, not the six in a row:
            the pill has to fit a narrow pane with a tool's sizes *and* a
            selection's verbs beside it, and six dots were a third of its
            width for a choice made once in a while. */}
        <button
          ref={colorRef}
          type="button"
          onClick={() => setColorsOpen((o) => !o)}
          aria-label="Colour"
          aria-expanded={colorsOpen}
          title={canDelete ? 'Colour — recolours the selection' : 'Colour'}
          className="btn-icon press h-7 w-7"
        >
          <span
            className="block h-4 w-4 rounded-full ring-1 ring-black/15"
            style={{ backgroundColor: style.color }}
          />
        </button>
        <Popover
          open={colorsOpen}
          anchorRef={colorRef}
          onClose={() => setColorsOpen(false)}
          width={6 * 24 + 16}
          // Above the full-screen score, which is a portal of its own at z-80.
          className="!z-[90] p-2"
        >
          <div className="flex items-center justify-between">
            {MARK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => {
                  onStyle({ ...style, color })
                  setColorsOpen(false)
                }}
                aria-label="Draw in this colour"
                aria-pressed={style.color === color}
                title="Colour"
                className={`press h-5 w-5 shrink-0 rounded-full border transition-transform ${
                  style.color === color
                    ? 'scale-110 border-fg-strong'
                    : 'border-line/70 hover:scale-105'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </Popover>

        {/* Weight only matters to a stroke — a highlighter's breadth is the
            box you drag, so offering it there would be a knob that does
            nothing. */}
        {drawing && tool !== 'highlight' && tool !== 'eraser' && (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />
            <div className="flex items-center gap-0.5">
              {WEIGHTS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => onStyle({ ...style, weight: w.value })}
                  aria-label={tool === 'text' ? `${w.size} text` : `${w.label} stroke`}
                  aria-pressed={style.weight === w.value}
                  title={tool === 'text' ? `${w.size} text` : `${w.label} stroke`}
                  className={`btn-icon press h-6 w-6 ${
                    style.weight === w.value ? 'text-fg-strong' : 'text-muted'
                  }`}
                >
                  <span
                    className="block rounded-full bg-current"
                    style={{ width: w.dot, height: w.dot }}
                  />
                </button>
              ))}
            </div>
          </>
        )}

        {/* What can be done to the mark in hand. Only while one is selected:
            three verbs that always mean nothing are three things to read past
            every time you pick up a highlighter. */}
        {canDelete && (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />
            <ToolButton active={false} label="Bring to front" onClick={onRaise}>
              <BringToFront size={14} />
            </ToolButton>
            <ToolButton active={false} label="Send to back" onClick={onLower}>
              <SendToBack size={14} />
            </ToolButton>
            <ToolButton active={false} label="Duplicate" onClick={onDuplicate}>
              <Copy size={14} />
            </ToolButton>
            <button
              type="button"
              onClick={onDelete}
              title={
                selectedCount > 1
                  ? `Delete the ${selectedCount} selected marks (Delete)`
                  : 'Delete the selected mark (Delete)'
              }
              aria-label="Delete the selected mark"
              className="btn-icon press h-6 w-6 text-danger"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}

      </div>
    </div>
  )
}

function ToolButton({
  active,
  label,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`btn-icon press h-7 w-7 disabled:pointer-events-none disabled:opacity-35 ${
        active ? 'bg-accent text-accentink' : 'text-muted hover:text-fg-strong'
      }`}
    >
      {children}
    </button>
  )
}
