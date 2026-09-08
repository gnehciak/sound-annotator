import {
  ArrowUpRight,
  Circle,
  Highlighter,
  MousePointer2,
  PenLine,
  Square,
  Trash2,
} from 'lucide-react'
import type { ScoreMarkKind } from '../types'
import { MARK_COLORS } from '../lib/score'
import type { MarkStyle, MarkTool } from './ScoreMarks'

const TOOLS: { kind: ScoreMarkKind; label: string; icon: typeof Square }[] = [
  { kind: 'highlight', label: 'Highlight', icon: Highlighter },
  { kind: 'box', label: 'Box', icon: Square },
  { kind: 'ellipse', label: 'Circle', icon: Circle },
  { kind: 'arrow', label: 'Arrow', icon: ArrowUpRight },
  { kind: 'ink', label: 'Draw', icon: PenLine },
]

/** Stroke weights, as the toolbar names them. */
const WEIGHTS = [
  { value: 1, label: 'Fine', dot: 2 },
  { value: 2, label: 'Medium', dot: 3.5 },
  { value: 3, label: 'Broad', dot: 5 },
]

/**
 * The drawing tools, floating at the foot of the score view.
 *
 * At the foot rather than the head because the page nav already lives at the
 * top and because a hand drawing on the page comes from below it — the same
 * reason a pen tray is at the bottom of a whiteboard.
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
  onDelete,
}: {
  tool: MarkTool
  onTool: (tool: MarkTool) => void
  style: MarkStyle
  onStyle: (style: MarkStyle) => void
  /** A mark is selected and can be removed. */
  canDelete: boolean
  onDelete: () => void
}) {
  const drawing = tool !== null && tool !== 'select'
  return (
    <div className="pointer-events-auto flex justify-center px-3">
      <div className="glass-pop flex max-w-full flex-wrap items-center justify-center gap-1 rounded-lg px-1.5 py-1.5 shadow-lg">
        <ToolButton
          active={tool === 'select' || tool === null}
          label={tool === null ? 'Reading — pick a tool to draw' : 'Select and move marks'}
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

        <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />

        <div className="flex items-center gap-0.5">
          {MARK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => onStyle({ ...style, color })}
              aria-label={`Draw in this colour`}
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

        {/* Weight only matters to a stroke — a highlighter's breadth is the
            box you drag, so offering it there would be a knob that does
            nothing. */}
        {drawing && tool !== 'highlight' && (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />
            <div className="flex items-center gap-0.5">
              {WEIGHTS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => onStyle({ ...style, weight: w.value })}
                  aria-label={`${w.label} stroke`}
                  aria-pressed={style.weight === w.value}
                  title={`${w.label} stroke`}
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

        {canDelete && (
          <>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-line/70" />
            <button
              type="button"
              onClick={onDelete}
              title="Delete the selected mark (Delete)"
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
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`btn-icon press h-7 w-7 ${
        active ? 'bg-accent text-accentink' : 'text-muted hover:text-fg-strong'
      }`}
    >
      {children}
    </button>
  )
}
