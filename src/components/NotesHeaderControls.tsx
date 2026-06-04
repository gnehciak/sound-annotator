import { Pin, PinOff, Crosshair } from 'lucide-react'
import type { NoteOrder } from '../lib/storage'
import TagFilter from './TagFilter'

/**
 * The inline controls in the Notes panel header: tag filter, list-order switch,
 * auto-pin and auto-cue. All are view preferences (they never mutate notes), so
 * they live here once and are rendered by both the editor (App) and the
 * read-only ShareViewer. Wired to {@link useNotesView}.
 */
export default function NotesHeaderControls({
  filterTags,
  activeFilter,
  onTagFilter,
  noteOrder,
  onNoteOrder,
  autoPin,
  onToggleAutoPin,
  autoSeek,
  onToggleAutoSeek,
  viewOnly = false,
}: {
  filterTags: string[]
  activeFilter: Set<string>
  onTagFilter: (next: Set<string>) => void
  noteOrder: NoteOrder
  onNoteOrder: (mode: NoteOrder) => void
  autoPin: boolean
  onToggleAutoPin: () => void
  autoSeek: boolean
  onToggleAutoSeek: () => void
  /**
   * View-only mode: drops the editor-specific controls — no auto-cue toggle
   * (note clicks just play) and no 'auto' order (only Timeline / Live).
   */
  viewOnly?: boolean
}) {
  // View-only omits 'auto'; the editor keeps the full stability↔liveness dial.
  const orderOptions = viewOnly
    ? NOTE_ORDER_OPTIONS.filter((o) => o.value !== 'auto')
    : NOTE_ORDER_OPTIONS
  return (
    <div className="flex items-center gap-1.5">
      <TagFilter tags={filterTags} selected={activeFilter} onChange={onTagFilter} />
      <NoteOrderControl
        value={noteOrder}
        onChange={onNoteOrder}
        options={orderOptions}
      />
      <button
        type="button"
        onClick={onToggleAutoPin}
        aria-pressed={autoPin}
        title={
          autoPin
            ? 'Auto-pin on: the playing note scrolls to the top — click to turn off'
            : 'Auto-pin off: the notes list stays put — click to turn on'
        }
        aria-label="Auto-pin the playing note to the top"
        className={`press rounded-sm p-1 ${
          autoPin
            ? 'bg-raised text-accentink'
            : 'text-muted hover:bg-raised hover:text-fg'
        }`}
      >
        {autoPin ? <Pin size={14} /> : <PinOff size={14} />}
      </button>
      {!viewOnly && (
        <button
          type="button"
          onClick={onToggleAutoSeek}
          aria-pressed={autoSeek}
          title={
            autoSeek
              ? 'Auto-cue on: clicking a note moves the playhead to it — click to turn off (⌘-click still cues)'
              : 'Auto-cue off: clicking a note just opens it — ⌘-click to cue the playhead, or click to turn on'
          }
          aria-label="Move the playhead to a note when you click it"
          className={`press rounded-sm p-1 ${
            autoSeek
              ? 'bg-raised text-accentink'
              : 'text-muted hover:bg-raised hover:text-fg'
          }`}
        >
          <Crosshair size={14} />
        </button>
      )}
    </div>
  )
}

// The notes list ordering, as a squared segmented switch (Timeline · Auto ·
// Live) — one stability↔liveness dial, not a matrix of when/which permutations.
// Mirrors the Edit | View switch; stays neutral (no amber) since none of the
// modes mean "now". Lives in the Notes title bar.
const NOTE_ORDER_OPTIONS: {
  value: NoteOrder
  label: string
  title: string
}[] = [
  {
    value: 'timeline',
    label: 'Timeline',
    title: 'Timeline — always in chronological (start-time) order',
  },
  {
    value: 'auto',
    label: 'Auto',
    title: 'Auto — live order while playing, timeline order when paused',
  },
  {
    value: 'live',
    label: 'Live',
    title: 'Live — always reorders around the playhead',
  },
]

function NoteOrderControl({
  value,
  onChange,
  options = NOTE_ORDER_OPTIONS,
}: {
  value: NoteOrder
  onChange: (mode: NoteOrder) => void
  options?: typeof NOTE_ORDER_OPTIONS
}) {
  return (
    <div
      role="group"
      aria-label="Note order"
      className="flex items-center gap-px rounded-sm border border-line bg-inset p-px"
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            title={opt.title}
            className={`press rounded-[1px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors duration-150 ${
              active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
