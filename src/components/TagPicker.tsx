import { useEffect, useRef, useState } from 'react'
import { Tag as TagIcon, Plus, X, Check } from 'lucide-react'
import { TAGS, resolveTag } from '../lib/tags'
import { usePresence } from '../lib/usePresence'
import { hueText } from '../lib/noteColors'
import { useResolvedTheme } from '../lib/theme'

interface Props {
  /** Tags currently on the note (preset ids or custom text). */
  tags: string[]
  /** Custom tags already used in this project, offered for one-click reuse. */
  projectTags?: string[]
  onChange: (tags: string[]) => void
}

/**
 * Multi-select tag editor: the note's tags shown as removable chips, plus a
 * dropdown to add more (preset checklist + project customs + a free-text field).
 * Toggling in the dropdown adds/removes; the menu stays open so several tags can
 * be set in one pass. Mirrors TagFilter's dropdown styling.
 */
export default function TagPicker({ tags, projectTags = [], onChange }: Props) {
  const theme = useResolvedTheme()
  const [open, setOpen] = useState(false)
  const pop = usePresence(open)
  const [text, setText] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = new Set(tags)
  // Project (custom) tags not already on the note, matching what's typed.
  const q = text.trim().toLowerCase()
  const suggestions = projectTags.filter(
    (t) => !selected.has(t) && t.toLowerCase().includes(q),
  )

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  // Focus the custom field when the menu opens.
  useEffect(() => {
    if (!open) return
    setText('')
    inputRef.current?.focus()
  }, [open])

  const toggle = (t: string) =>
    onChange(selected.has(t) ? tags.filter((x) => x !== t) : [...tags, t])
  const remove = (t: string) => onChange(tags.filter((x) => x !== t))
  const commitCustom = () => {
    const v = text.trim()
    if (v && !selected.has(v)) onChange([...tags, v])
    setText('') // stay open so more can be added
  }

  return (
    // stop clicks from toggling the note's selection / expand state
    <div
      ref={ref}
      className="relative flex flex-wrap items-center gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {tags.map((t) => {
        const c = resolveTag(t)!
        return (
          <span
            key={t}
            className="flex items-center gap-1.5 rounded-sm border px-2 py-[3px] font-mono text-[10px] font-semibold uppercase tracking-[0.12em]"
            style={{
              // 45%-mix ring (the prototype's .tagchip): softer than full-strength
              // hueText while keeping the AA-adjusted base for theme safety.
              borderColor: `color-mix(in srgb, ${hueText(c.color, theme)} 45%, transparent)`,
              color: hueText(c.color, theme),
              background: `color-mix(in srgb, ${c.color} 10%, transparent)`,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: c.color }}
            />
            {c.label}
            <button
              type="button"
              onClick={() => remove(t)}
              title={`Remove ${c.label}`}
              aria-label={`Remove ${c.label}`}
              className="press -mr-0.5 rounded opacity-60 hover:opacity-100"
            >
              <X size={11} />
            </button>
          </span>
        )
      })}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Add a tag"
        aria-label="Add a tag"
        className="press flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        {tags.length === 0 ? (
          <>
            <TagIcon size={11} /> Tag
          </>
        ) : (
          <>
            <Plus size={11} /> Tag
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
              className="bevel-inset w-full rounded border border-line bg-inset px-2 py-1.5 text-[11px] text-fg placeholder:text-muted focus:border-accent"
            />
          </form>

          {suggestions.length > 0 && (
            <>
              <div className="px-2.5 pb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
                This project
              </div>
              {suggestions.map((t) => {
                const c = resolveTag(t)!
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(t)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:bg-raised"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: c.color }}
                    />
                    <span className="truncate">{c.label}</span>
                  </button>
                )
              })}
            </>
          )}

          <div className="px-2.5 pb-1 pt-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            Presets
          </div>
          {TAGS.map((t) => {
            const on = selected.has(t.id)
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => toggle(t.id)}
                aria-pressed={on}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] uppercase tracking-[0.1em] hover:bg-raised ${
                  on ? 'text-fg' : 'text-muted'
                }`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: t.color }}
                />
                <span className="flex-1 truncate">{t.label}</span>
                {on && <Check size={12} className="shrink-0 text-accentink" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
