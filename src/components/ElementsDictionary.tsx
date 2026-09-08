// The concept vocabulary, browsable, at the foot of a note — and the third way
// a property tag gets written, after the "@" menu and typing the word itself.
//
// It stands where the "+ Property" menu used to. That menu added a whole grid
// of empty dropdowns under the note and asked you to fill it in away from the
// sentence the observation belonged to; a tag says the same thing in the prose,
// at the point it applies. What the grid was genuinely good at was *showing you
// the words* — 434 of them, which nobody holds in their head — so that is what
// this keeps, minus the block.
//
// Search-first, because a concept you can name is a concept you can find. The
// eight concept chips are the way in when you can't: pick one and its whole
// field list opens, which is the "what could I say here?" browse the "@" menu
// deliberately doesn't do (it needs a query).
import { useMemo, useRef, useState } from 'react'
import { BookOpen, ChevronDown, Search } from 'lucide-react'
import {
  VOCAB_CATEGORIES,
  VOCAB_SIZE,
  hueFor,
  searchProperties,
} from '../lib/propertyTags'
import { hueText } from '../lib/noteColors'
import { useResolvedTheme } from '../lib/theme'

/** A field's worth of words, as the list renders them. */
interface Group {
  key: string
  category: string
  fieldLabel: string
  field: string
  options: string[]
}

export default function ElementsDictionary({
  onInsert,
}: {
  /** Write the word into the note as a tag, at the caret. */
  onInsert: (field: string, value: string) => void
}) {
  const theme = useResolvedTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const groups = useMemo<Group[]>(() => {
    const q = query.trim()
    if (q) {
      // The "@" menu's own search, so the two surfaces rank alike — and so the
      // words you could have said instead of the one you found come with it.
      const hits = searchProperties(q, 60).filter(
        (o) => !cat || catIdOf(o.field) === cat,
      )
      const byField = new Map<string, Group>()
      for (const o of hits) {
        const g = byField.get(o.field)
        if (g) g.options.push(o.value)
        else
          byField.set(o.field, {
            key: o.field,
            category: o.category,
            fieldLabel: o.fieldLabel,
            field: o.field,
            options: [o.value],
          })
      }
      return [...byField.values()]
    }
    const picked = VOCAB_CATEGORIES.find((c) => c.id === cat)
    if (!picked) return []
    return picked.fields.map((f) => ({
      key: f.id,
      category: picked.label,
      fieldLabel: f.label,
      field: f.id,
      options: f.options,
    }))
  }, [query, cat])

  return (
    <div ref={rootRef} className="border-t border-line">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o)
          // It sits at the very bottom of a scrolling inspector, so opening it
          // otherwise unfolds the whole thing below the fold.
          if (!open)
            requestAnimationFrame(() => {
              rootRef.current?.scrollIntoView({ block: 'nearest' })
              searchRef.current?.focus()
            })
        }}
        aria-expanded={open}
        title="Every word the concept vocabulary knows — click one to tag it here"
        className="flex w-full items-center gap-2 px-[13px] py-2.5 text-left"
      >
        <BookOpen size={12} className="shrink-0 text-muted" />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-fg">
          Elements of music
        </span>
        <span className="font-mono text-[10px] text-muted">{VOCAB_SIZE} words</span>
        <div className="flex-1" />
        <ChevronDown
          size={13}
          className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="animate-fade-in px-[13px] pb-3">
          <div className="relative mb-2">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — e.g. timbre bright, hemiola, ternary"
              aria-label="Search the concept vocabulary"
              className="field pl-[26px]"
            />
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            {VOCAB_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat((v) => (v === c.id ? null : c.id))}
                aria-pressed={cat === c.id}
                className="chip press"
                style={{
                  ['--hue' as string]: c.color,
                  color: hueText(c.color, theme),
                }}
              >
                {c.label}
              </button>
            ))}
          </div>

          {groups.length === 0 ? (
            <p className="px-0.5 py-1 text-[11.5px] leading-snug text-muted">
              {!query
                ? 'Pick a concept, or search. Clicking a word writes it into the note as a tag.'
                : cat
                  ? `Nothing like that under ${
                      VOCAB_CATEGORIES.find((c) => c.id === cat)?.label
                    } — unpick it to search every concept.`
                  : 'No word like that. The vocabulary is finite; type “@” in the note to tag the word you want anyway.'}
            </p>
          ) : (
            <div className="max-h-56 space-y-2.5 overflow-y-auto pr-0.5">
              {groups.map((g) => (
                <div key={g.key}>
                  <div className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {g.fieldLabel}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {g.options.map((value) => {
                      const color = hueFor(g.field, value)
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => onInsert(g.field, value)}
                          title={`Tag this note — ${g.category}: ${value}`}
                          className="chip chip-outline press normal-case tracking-[0.01em]"
                          style={{
                            ['--hue' as string]: color,
                            color: hueText(color, theme),
                          }}
                        >
                          {value}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The category a field id belongs to — "pitch.contour" → "pitch". */
function catIdOf(field: string): string {
  return VOCAB_CATEGORIES.find((c) => c.fields.some((f) => f.id === field))?.id ?? ''
}
