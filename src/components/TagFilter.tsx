import { useEffect, useRef, useState } from 'react'
import { Check, ListFilter } from 'lucide-react'
import { resolveTag } from '../lib/tags'
import { usePresence } from '../lib/usePresence'

interface Props {
  /** Every tag in use across the project's notes, in display order. */
  tags: string[]
  /** Currently selected tags (empty = show all). A note matches any of them. */
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

/**
 * Notes filter: a compact button in the Notes title bar that opens a checklist
 * of the tags actually used in this project. Picking one or more narrows the
 * list to notes carrying any selected tag (OR). Mirrors TagPicker's dropdown.
 */
export default function TagFilter({ tags, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const pop = usePresence(open)
  const ref = useRef<HTMLDivElement>(null)
  const active = selected.size > 0

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const toggle = (tag: string) => {
    const next = new Set(selected)
    if (next.has(tag)) next.delete(tag)
    else next.add(tag)
    onChange(next)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-pressed={active}
        title={
          active
            ? `Filtering by ${selected.size} tag${selected.size === 1 ? '' : 's'} — click to change`
            : 'Filter notes by tag'
        }
        aria-label="Filter notes by tag"
        className={`press flex items-center gap-1 rounded-sm px-1.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
          active
            ? 'bg-raised text-accent'
            : 'text-muted hover:bg-raised hover:text-fg'
        }`}
      >
        <ListFilter size={14} />
        {active && <span className="leading-none">{selected.size}</span>}
      </button>

      {pop.mounted && (
        <div
          className={`absolute right-0 top-full z-30 mt-1 w-44 origin-top-right rounded border border-line bg-panel py-1 shadow-lg ${
            pop.closing ? 'animate-pop-out' : 'animate-pop-in'
          }`}
        >
          <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-0.5">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
              Filter by tag
            </span>
            {active && (
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="font-mono text-[9px] uppercase tracking-wider text-muted hover:text-fg"
              >
                Clear
              </button>
            )}
          </div>

          {tags.length === 0 ? (
            <div className="px-2.5 py-2 text-[11px] text-muted">
              No tagged notes yet.
            </div>
          ) : (
            tags.map((t) => {
              const c = resolveTag(t)!
              const on = selected.has(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggle(t)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 px-2.5 py-1 text-left font-mono text-[11px] uppercase tracking-wider hover:bg-raised ${
                    on ? 'text-fg' : 'text-muted'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: c.color }}
                  />
                  <span className="flex-1 truncate">{c.label}</span>
                  {on && <Check size={12} className="shrink-0 text-accent" />}
                </button>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
