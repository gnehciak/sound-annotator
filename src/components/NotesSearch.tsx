import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'

interface Props {
  value: string
  onChange: (q: string) => void
  /** Matches shown / total notes, for the count readout. */
  count: number
  total: number
  /** Clear the query and close the search row (× or Esc). */
  onClose: () => void
}

/**
 * The notes search row: a slim field docked beneath the Notes header. Filters
 * the list live (composing with the tag filter) across timecode, note text,
 * tags and section names — wired to {@link useNotesView}. Auto-focuses on open;
 * Esc or the × clears the query and closes the row. Shared by the editor (App)
 * and the read-only ShareViewer.
 */
export default function NotesSearch({ value, onChange, count, total, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  // Focus the field as soon as the row reveals so you can type immediately.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <div className="flex items-center gap-2 border-b border-line bg-panel px-2.5 py-1.5">
      <Search size={14} className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
        placeholder="Search notes…"
        aria-label="Search notes"
        className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-fg placeholder:text-muted focus:outline-none"
      />
      {value.trim() !== '' && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
          {count}/{total}
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close search"
        title="Close search (Esc)"
        className="press shrink-0 rounded-sm p-0.5 text-muted hover:bg-raised hover:text-fg"
      >
        <X size={14} />
      </button>
    </div>
  )
}
