import { useEffect, useRef, useState } from 'react'
import { Tag as TagIcon } from 'lucide-react'
import { TAGS, isPreset, resolveTag } from '../lib/tags'
import { usePresence } from '../lib/usePresence'

interface Props {
  tag?: string
  onChange: (tag: string | undefined) => void
}

export default function TagPicker({ tag, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const pop = usePresence(open)
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const current = resolveTag(tag)

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  // On open, seed the field with the current custom tag and focus it.
  useEffect(() => {
    if (!open) return
    setText(tag && !isPreset(tag) ? tag : '')
    inputRef.current?.focus()
  }, [open, tag])

  const commitCustom = () => {
    const v = text.trim()
    if (v) {
      onChange(v)
      setOpen(false)
    }
  }

  return (
    // stop clicks from toggling the note's expand state
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Tag this note"
        className="flex items-center gap-1 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted hover:text-fg"
        style={current ? { borderColor: current.color, color: current.color } : undefined}
      >
        {current ? (
          <>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: current.color }}
            />
            {current.label}
          </>
        ) : (
          <>
            <TagIcon size={11} /> Tag
          </>
        )}
      </button>

      {pop.mounted && (
        <div
          className={`absolute left-0 top-full z-20 mt-1 w-44 origin-top-left rounded border border-line bg-panel py-1 shadow-lg ${
            pop.closing ? 'animate-pop-out' : 'animate-pop-in'
          }`}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault()
              commitCustom()
            }}
            className="px-2 pb-1.5 pt-1"
          >
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Custom tag…"
              aria-label="Custom tag"
              className="w-full rounded border border-line bg-inset px-2 py-1 text-[11px] text-fg placeholder:text-muted focus:border-accent"
            />
          </form>

          <div className="px-2.5 pb-1 font-mono text-[9px] uppercase tracking-wider text-muted">
            Presets
          </div>
          {TAGS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onChange(t.id)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-1 text-left font-mono text-[11px] uppercase tracking-wider hover:bg-raised ${
                tag === t.id ? 'text-fg' : 'text-muted'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: t.color }}
              />
              {t.label}
            </button>
          ))}

          {tag && (
            <button
              type="button"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
              className="mt-1 flex w-full items-center border-t border-line px-2.5 py-1 text-left font-mono text-[10px] uppercase tracking-wider text-muted hover:bg-raised"
            >
              Clear tag
            </button>
          )}
        </div>
      )}
    </div>
  )
}
