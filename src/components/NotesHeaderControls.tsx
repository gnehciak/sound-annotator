import { Search } from 'lucide-react'
import type { NoteOrder } from '../lib/storage'
import TagFilter from './TagFilter'

/**
 * The inline controls in the Notes panel header: search, tag filter, and the
 * list-order switch. All are view preferences (they never mutate notes), so they
 * live here once and are rendered by both the editor (App) and the read-only
 * ShareViewer. Wired to {@link useNotesView}. Auto-pin and auto-cue have no
 * controls of their own — both are coupled to the order (on for Live/Auto, off
 * for Timeline).
 */
export default function NotesHeaderControls({
  filterTags,
  filterTagCounts,
  activeFilter,
  onTagFilter,
  noteOrder,
  onNoteOrder,
  searchOpen,
  searchActive,
  onToggleSearch,
  viewOnly = false,
}: {
  filterTags: string[]
  filterTagCounts: Map<string, number>
  activeFilter: Set<string>
  onTagFilter: (next: Set<string>) => void
  noteOrder: NoteOrder
  onNoteOrder: (mode: NoteOrder) => void
  /** Whether the search row is open, and whether it currently has a query. */
  searchOpen: boolean
  searchActive: boolean
  onToggleSearch: () => void
  /**
   * View-only mode: drops the 'auto' order (only Timeline / Live).
   */
  viewOnly?: boolean
}) {
  // View-only omits 'auto'; the editor keeps the full stability↔liveness dial.
  const orderOptions = viewOnly
    ? NOTE_ORDER_OPTIONS.filter((o) => o.value !== 'auto')
    : NOTE_ORDER_OPTIONS
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggleSearch}
        aria-pressed={searchOpen}
        title={searchActive ? 'Search active — click to change' : 'Search notes'}
        aria-label="Search notes"
        className={`press rounded-sm p-1 ${
          searchOpen || searchActive
            ? 'bg-raised text-accentink'
            : 'text-muted hover:bg-raised hover:text-fg'
        }`}
      >
        <Search size={14} />
      </button>
      <TagFilter
        tags={filterTags}
        counts={filterTagCounts}
        selected={activeFilter}
        onChange={onTagFilter}
      />
      <NoteOrderControl
        value={noteOrder}
        onChange={onNoteOrder}
        options={orderOptions}
      />
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
    title:
      'Timeline — always chronological (start-time) order; the list stays put and clicking a note leaves the playhead alone (⌘-click cues)',
  },
  {
    value: 'auto',
    label: 'Auto',
    title:
      'Auto — follows the playhead while playing (pins it to the top), chronological when paused; clicking a note cues the playhead',
  },
  {
    value: 'live',
    label: 'Live',
    title:
      'Live — always reorders around the playhead and pins the playing note to the top; clicking a note cues the playhead',
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
