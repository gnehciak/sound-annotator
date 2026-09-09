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
//
// It is a modal rather than a panel folded into the note. Six hundred words
// need room, and the inspector is a narrow column that was already scrolling —
// opening the vocabulary inside it pushed the note itself off the screen, which
// is the one thing you want to keep looking at while choosing a word. Clicking
// a word writes it into the note behind and leaves the modal open, because
// picking two or three in a row is the normal case.
//
// **It portals to <body>, and it has to.** The inspector is hosted inside
// PluginWindow, whose pane carries `backdrop-filter` — and a backdrop-filter
// ancestor becomes the containing block for `position: fixed`. Rendered in
// place, `inset-0` covered the inspector's own box rather than the viewport
// (measured: 510×443 inside an 881×1057 window), the panel sampled its own
// ancestor instead of the page so the frosting came out transparent, and the
// note's chrome painted over it from the same stacking context. Same reason
// the expanded score portals — see CLAUDE.md.
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookOpen, Search, X } from 'lucide-react'
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
  onClose,
}: {
  /** Write the word into the note as a tag, at the caret. */
  onInsert: (field: string, value: string) => void
  onClose: () => void
}) {
  const theme = useResolvedTheme()
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [lastPicked, setLastPicked] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    searchRef.current?.focus()
    // Capture phase, and stopImmediatePropagation: the app closes the note
    // inspector on Escape with its own window listener, and plain
    // stopPropagation does not stop a sibling listener on the same target — so
    // one press would shut the dictionary *and* the note behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      e.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

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

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center bg-ink/70 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Elements of music"
        className="glass-pop flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl"
      >
        <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line/70 bg-fg/[0.03] px-3.5">
          <BookOpen size={13} className="shrink-0 text-muted" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Elements of music
          </span>
          <span className="font-mono text-[10px] text-muted">{VOCAB_SIZE} words</span>
          <div className="flex-1" />
          {lastPicked && (
            <span className="animate-fade-in font-mono text-[10px] text-accentink">
              {lastPicked} added
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="btn-icon press"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex min-h-0 flex-col gap-2 px-4 py-3.5">
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search — e.g. timbre bright, cor anglais, hemiola, 7/8"
              aria-label="Search the concept vocabulary"
              className="field pl-[26px]"
            />
          </div>

          <div className="flex flex-wrap gap-1">
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
            <p className="px-0.5 py-3 text-[11.5px] leading-snug text-muted">
              {!query
                ? 'Pick a concept, or search. Clicking a word writes it into the note as a tag.'
                : cat
                  ? `Nothing like that under ${
                      VOCAB_CATEGORIES.find((c) => c.id === cat)?.label
                    } — unpick it to search every concept.`
                  : 'No word like that. The vocabulary is finite; type “@” in the note to tag the word you want anyway.'}
            </p>
          ) : (
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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
                          onClick={() => {
                            onInsert(g.field, value)
                            setLastPicked(value)
                          }}
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
      </div>
    </div>,
    document.body,
  )
}

/** The category a field id belongs to — "pitch.contour" → "pitch". */
function catIdOf(field: string): string {
  return VOCAB_CATEGORIES.find((c) => c.fields.some((f) => f.id === field))?.id ?? ''
}
