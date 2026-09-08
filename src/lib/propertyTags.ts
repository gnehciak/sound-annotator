// Inline property tags: the searchable vocabulary behind typing "@" in a note's
// text, and the reader that pulls the tags back out of stored note HTML.
//
// A property tag is a *value* the user committed to inline — "@rising" mid
// sentence becomes a hued Pitch·Rising chip sitting in the prose, right beside
// the point it belongs to. That's the difference from the `elements` property
// block (lib/musicElements.ts), which is the same taxonomy collected into one
// grid underneath the note. The taxonomy is shared; only the placement differs.
//
// Tags live inside the note's rich-text HTML (a TipTap inline atom node — see
// components/propertyTag.tsx), not in a field of their own, so they need no
// schema, no API change, and no line in projectJson's sanitizer: they travel
// wherever `contentHtml` travels.
import { ELEMENTS, LAYERS, type ElementField } from './musicElements'
import { hueText } from './noteColors'

/** Field id of the synthetic "Layer" category (LAYERS, as a pickable field). */
export const LAYER_FIELD = 'layer'

/** One pickable value in the "@" menu — a leaf of the elements taxonomy. */
export interface PropertyOption {
  /** Stable key for React lists and de-duplication. */
  key: string
  /** Field the value belongs to (`layer`, `pitch.contour`, … or '' if custom). */
  field: string
  /** Category label shown on the chip's left half (e.g. "Pitch"). */
  category: string
  /** Field label, for the menu's second line (e.g. "Melodic contour"). */
  fieldLabel: string
  /** The value itself — the chip's right half. */
  value: string
  /** Category hue. */
  color: string
}

/** A tag as read back off a note: what the chip stored, plus its resolved look. */
export interface PropertyTagRef {
  field: string
  value: string
  category: string
  color: string
}

/** Neutral hue for a custom (free-typed) tag with no field behind it. */
export const CUSTOM_HUE = '#9a9aa2'

interface FieldInfo {
  field: ElementField
  category: string
  color: string
}

const FIELDS = new Map<string, FieldInfo>()
for (const cat of ELEMENTS) {
  for (const f of cat.fields) {
    FIELDS.set(f.id, { field: f, category: cat.label, color: cat.color })
  }
}

/** Every value in the taxonomy, flattened once: layers first, then elements. */
const ALL: PropertyOption[] = [
  ...LAYERS.map((l) => ({
    key: `${LAYER_FIELD}:${l.id}`,
    field: LAYER_FIELD,
    category: 'Layer',
    fieldLabel: 'Layer',
    value: l.label,
    color: l.color,
  })),
  ...ELEMENTS.flatMap((cat) =>
    cat.fields.flatMap((f) =>
      f.options.map((opt) => ({
        key: `${f.id}:${opt}`,
        field: f.id,
        category: cat.label,
        fieldLabel: f.label,
        value: opt,
        color: cat.color,
      })),
    ),
  ),
]

/**
 * Where a value matched the query. Lower sorts first; -1 means no match.
 */
function scoreValue(opt: PropertyOption, term: string): number {
  const v = opt.value.toLowerCase()
  if (v === term) return 0
  if (v.startsWith(term)) return 1
  // A later word of a multi-word value — "register" inside "high register".
  if (v.includes(` ${term}`)) return 2
  if (v.includes(term)) return 3
  return -1
}

/** Same, for a value's field and category names — the coarser fallback. */
function scoreLabel(opt: PropertyOption, term: string): number {
  if (opt.fieldLabel.toLowerCase().includes(term)) return 4
  if (opt.category.toLowerCase().includes(term)) return 5
  return -1
}

/**
 * The values a leading run of words narrows to, or null if it names nothing.
 * Two characters is the floor, so "@p" still finds the dynamic rather than
 * disappearing into the Pitch category.
 */
function scopeFor(head: string): PropertyOption[] | null {
  const h = head.trim().toLowerCase()
  if (h.length < 2) return null
  const byFieldStart = ALL.filter((o) => o.fieldLabel.toLowerCase().startsWith(h))
  if (byFieldStart.length) return byFieldStart
  const byCategory = ALL.filter((o) => o.category.toLowerCase().startsWith(h))
  if (byCategory.length) return byCategory
  const byField = ALL.filter((o) => o.fieldLabel.toLowerCase().includes(h))
  return byField.length ? byField : null
}

const ranked = (pool: PropertyOption[], term: string, score = scoreValue) =>
  pool
    .map((o) => ({ o, s: score(o, term) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => a.s - b.s)
    .map((x) => x.o)

/**
 * Values matching a "@" query, best-first — and then, deliberately, the words
 * you could have used instead.
 *
 * The menu narrows the way an editor's completion list does. A leading run of
 * words that names a category or a field scopes the search, and what is left
 * is matched inside that scope: "@timbre bright" is Bright *within* Timbre.
 * Once a value is pinned, the rest of its field follows it down the list, so
 * the answer to "what else could I say instead of bright?" is on screen
 * without retyping — which is the whole point of the menu over free text.
 *
 * A query that names nothing at all returns nothing, and the caller hides the
 * popup rather than parking an empty menu over the prose.
 */
export function searchProperties(query: string, limit = 10): PropertyOption[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return ALL.slice(0, limit)
  const words = q.split(' ')

  // Longest leading run of words that names a category or field wins the
  // scope; the remainder is the term searched inside it.
  let pool = ALL
  let term = q
  for (let take = words.length; take >= 1; take--) {
    const scoped = scopeFor(words.slice(0, take).join(' '))
    if (scoped) {
      pool = scoped
      term = words.slice(take).join(' ')
      break
    }
  }

  let hits: PropertyOption[]
  if (!term) {
    hits = pool // the query named a scope and nothing more — show all of it
  } else {
    hits = ranked(pool, term)
    // Scoped but empty: the scope was a wrong guess, so widen back out.
    if (!hits.length && pool !== ALL) hits = ranked(ALL, term)
    // Still nothing: match the words against category and field names.
    if (!hits.length) hits = ranked(ALL, term, scoreLabel)
  }

  const top = hits[0]
  const alternatives = top
    ? ALL.filter((o) => o.field === top.field && !hits.includes(o))
    : []
  return [...hits, ...alternatives].slice(0, limit)
}

/**
 * Words that tag themselves as you type, with no "@" — the rest of the
 * vocabulary stays a keystroke away behind the menu.
 *
 * This is an allowlist rather than a stoplist, and deliberately so: it holds
 * only terms you would essentially never type in a music note in their
 * everyday sense. "Legato", "hemiola" and "monophonic" can fire on sight;
 * "even", "light", "full", "clear", "return" and "major" cannot, because a
 * sentence about music uses those words as ordinary English several times a
 * paragraph and a chip would land in the middle of one. Dynamic letters (p, f,
 * ff…) are out for the same reason, only more so.
 *
 * Failing closed is the point — a term added to the taxonomy later does not
 * start auto-firing until someone puts it here on purpose. Add a line to widen
 * it; every entry must match a value in lib/musicElements.ts exactly (the
 * index below silently drops any that does not).
 */
const AUTO_TERMS = [
  // Performance markings and playing techniques — the Italian and the named.
  'Accelerando', 'Allegro', 'Animando', 'Arco', 'Cantabile', 'Crescendo',
  'Decrescendo', 'Delicatamente', 'Diminuendo', 'Dolce', 'Espressivo',
  'Glissandi', 'Glissando', 'Grazioso', 'Legato', 'Leggierissimo', 'Leggiero',
  'Lento', 'Maestoso', 'Marcato', 'Pizzicato', 'Rallentando', 'Ritardando',
  'Ritenuto', 'Rubato', 'Semplice', 'Sfzp', 'Spiccato', 'Staccatissimo',
  'Staccato', 'Tenuto', 'Tremolo', 'Trill', 'Vibrato',
  // Pitch and harmony.
  'Aeolian', 'Arpeggiated', 'Ascending', 'Augmented', 'Bitonal', 'Cadential',
  'Cadenza', 'Chromatic', 'Chromaticism', 'Cluster-like', 'Clusters',
  'Conjunct', 'Consonant', 'Descending', 'Diatonic', 'Diminished',
  'Disjunct', 'Dissonance', 'Dissonant', 'Dorian', 'Drone', 'Florid',
  'Imperfect', 'Mixolydian', 'Modal', 'Modality', 'Modulating', 'Pentatonic',
  'Phrygian', 'Polytonal', 'Quartal', 'Scale-based', 'Scalic', 'Stepwise',
  'Tessitura', 'Tonal', 'Triadic', 'Unresolved', 'Whole-tone',
  // Duration.
  'Anacrusis', 'Compound', 'Cross-rhythm', 'Dotted', 'Duple', 'Duplet',
  'Hemiola', 'Hemiolic', 'Multimetric', 'Off-beat', 'Polyrhythm',
  'Polyrhythmic', 'Quadruple', 'Quintuplet', 'Sextuplet', 'Syncopated',
  'Triple', 'Triplet',
  // Texture and structure.
  'Antiphonal', 'Canon', 'Canonic', 'Contrapuntal', 'Counter-melody',
  'Countermelody', 'Fugal', 'Fugue-like', 'Hocket', 'Homogenous',
  'Homophonic', 'Imitation', 'Imitative', 'Monophonic', 'Ostinato',
  'Polyphonic', 'Polyphony', 'Augmentation', 'Call-and-response', 'Climactic',
  'Coda', 'Codetta', 'Diminution', 'Motivic', 'Question-and-answer',
  'Sectional', 'Sequential', 'Through-composed',
  // Timbre and expression that read as terms of art, not description.
  'Accented', 'Arc-shaped', 'Bell-like', 'Chant-like', 'Dance-like',
  'Echoey', 'Ethereal', 'Lilting', 'Lyrical', 'March-like', 'Mellow',
  'Metallic', 'Nasal', 'Percussive', 'Slurred', 'Slurs', 'Terraced',
  'Warlike',
  // Performing media.
  'Blowing', 'Bowing', 'Brass', 'Choir', 'Duet', 'Orchestra', 'Percussion',
  'Plucking', 'Quartet', 'Quintet', 'Trio', 'Woodwind',
]

/** Lowercased auto-taggable word → the option it stands for. */
const AUTO_INDEX = new Map<string, PropertyOption>()
for (const term of AUTO_TERMS) {
  const hit = ALL.find((o) => o.value === term)
  if (hit) AUTO_INDEX.set(term.toLowerCase(), hit)
}

/**
 * The option a just-typed word tags itself as, if any. Case-insensitive, so
 * "monophonic" mid-sentence and "Monophonic" after a full stop both land.
 */
export function autoTagFor(word: string): PropertyOption | undefined {
  return AUTO_INDEX.get(word.toLowerCase())
}

/** Auto-taggable terms that no longer match a value — a dev-time typo check. */
export function unmatchedAutoTerms(): string[] {
  return AUTO_TERMS.filter((t) => !ALL.some((o) => o.value === t))
}

// ---------------------------------------------------------------------------
// Suggesting: the other 300 words, offered rather than applied
// ---------------------------------------------------------------------------
//
// AUTO_TERMS is narrow on purpose, and it always will be — a word that tags
// itself has to be one you would never type in its everyday sense, which rules
// out "even", "thin", "warm" and most of the vocabulary. But those are exactly
// the words a note about music is *made* of, and leaving them untagged because
// auto-tagging them would be reckless gets the worst of both.
//
// So the rest of the vocabulary is underlined instead of converted (see
// components/propertySuggest.ts): the note says "this word names a concept",
// and one click makes it a tag. Being wrong costs a faint underline someone
// ignores, so this list is the whole vocabulary rather than an allowlist —
// the opposite call from AUTO_TERMS, for the opposite reason.

/** Lowercased value → every option carrying it (a word can sit in two fields). */
const BY_VALUE = new Map<string, PropertyOption[]>()
for (const o of ALL) {
  const k = o.value.toLowerCase()
  const list = BY_VALUE.get(k)
  if (list) list.push(o)
  else BY_VALUE.set(k, [o])
}

/**
 * Values worth underlining in prose. Single letters are out (a lone "f" is a
 * word in a sentence far more often than it is a dynamic), and so are the
 * glossed forms — "Sforzando (sfz)", "Static (volume)" — which are menu labels
 * rather than anything a person types into a sentence.
 */
const SUGGESTABLE = [...BY_VALUE.keys()]
  .filter((v) => v.length > 1 && !v.includes('('))
  // Longest first, so "high register" wins the position "register" would take.
  .sort((a, b) => b.length - a.length)

/** Characters that make a match part of a longer word rather than its own. */
const WORDISH = "\\p{L}\\p{M}\\p{N}'’-"

const SUGGEST_RE = new RegExp(
  `(?<![${WORDISH}])(?:${SUGGESTABLE.map((v) =>
    v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|')})(?![${WORDISH}])`,
  'giu',
)

/** A run of prose that names a concept: where it is, and what it could become. */
export interface TaggableMatch {
  /** Offsets into the text that was scanned. */
  from: number
  to: number
  /** The words as typed (which may differ in case from the vocabulary's). */
  text: string
  /** Every option that word names — more than one when two fields share it. */
  options: PropertyOption[]
}

/**
 * Vocabulary words inside a run of plain text, in order and non-overlapping.
 * Case-insensitive, and matched at word boundaries so "even" in "evening" and
 * "beat" in "off-beat" are left alone.
 */
export function findTaggable(text: string): TaggableMatch[] {
  const out: TaggableMatch[] = []
  // matchAll clones the regex, so the shared `g` instance keeps no lastIndex.
  for (const m of text.matchAll(SUGGEST_RE)) {
    const options = BY_VALUE.get(m[0].toLowerCase())
    if (!options) continue
    out.push({
      from: m.index,
      to: m.index + m[0].length,
      text: m[0],
      options,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Browsing: the dictionary at the foot of a note
// ---------------------------------------------------------------------------

/** The vocabulary as a browsable tree — the eight concepts, then Layer. */
export const VOCAB_CATEGORIES: {
  id: string
  label: string
  color: string
  fields: { id: string; label: string; options: string[] }[]
}[] = [
  ...ELEMENTS,
  {
    id: LAYER_FIELD,
    label: 'Layer',
    color: LAYERS[0].color,
    fields: [{ id: LAYER_FIELD, label: 'Layer', options: LAYERS.map((l) => l.label) }],
  },
]

/** How many words the dictionary holds — shown on its header. */
export const VOCAB_SIZE = ALL.length

/** Sibling values a chip can be switched to (empty for a custom tag). */
export function optionsForField(field: string): string[] {
  if (field === LAYER_FIELD) return LAYERS.map((l) => l.label)
  return FIELDS.get(field)?.field.options ?? []
}

/** Resolve a stored `field` to the category label + hue its chip wears. */
export function describeField(field: string): { category: string; color: string } {
  if (field === LAYER_FIELD) return { category: 'Layer', color: LAYERS[0].color }
  const info = FIELDS.get(field)
  return info
    ? { category: info.category, color: info.color }
    : { category: '', color: CUSTOM_HUE }
}

/**
 * The hue a specific (field, value) pair wears. Layers are the one category
 * whose colour varies per value — each layer is its own identity colour — so
 * resolve through the value there and through the category everywhere else.
 */
export function hueFor(field: string, value: string): string {
  if (field === LAYER_FIELD) {
    const v = value.toLowerCase()
    return LAYERS.find((l) => l.label.toLowerCase() === v)?.color ?? LAYERS[0].color
  }
  return describeField(field).color
}

/**
 * Property tags carried by a note's text HTML, in document order. The chips are
 * the note's structured data even though they live in prose, so search, export
 * and any future filter read them from here rather than re-parsing the markup.
 */
export function propertyTagsInHtml(html: string): PropertyTagRef[] {
  if (!html || !html.includes('data-property-tag')) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('[data-property-tag]')).map((el) => {
    const field = el.getAttribute('data-field') ?? ''
    const value = el.getAttribute('data-value') ?? ''
    return { field, value, ...describeField(field), color: hueFor(field, value) }
  })
}

/** One-line digest of a note's inline tags — for spec lines and exports. */
export function summarizePropertyTags(html: string): string {
  return propertyTagsInHtml(html)
    .map((t) => (t.category ? `${t.category}: ${t.value}` : t.value))
    .join(' · ')
}

/**
 * Styles for the two print documents that inject note HTML raw — the track
 * export (lib/exportPdf.ts) and the student answer sheet (lib/answerSheet.ts).
 * Both render on white paper with no React around them, so the chip's ink
 * comes from `--hue-ink` (the AA-safe light-theme hue the node stamps
 * alongside `--hue`) rather than the raw signal colour.
 */
export const PROPERTY_TAG_PRINT_CSS = `
  .prop-tag {
    white-space: nowrap;
    border-radius: 3px;
    padding: 0 3px;
    margin: 0 -1px;
    /* The same faint ground the tag wears in the light theme, so an exported
       note looks like the note it was exported from. */
    background: color-mix(in srgb, var(--hue, #9a9aa2) 13%, transparent);
    color: var(--hue-ink, #57534e);
    font-weight: 600;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /* On screen the concept is a tooltip. Paper has no hover, and colour alone
     means nothing without a legend, so print it after the value. */
  .prop-tag[data-category]:not([data-category=''])::after {
    content: ' (' attr(data-category) ')';
    font-size: 9px;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }
`

/** The AA-safe ink a chip's category label and border wear on white paper. */
export function inkFor(field: string, value: string): string {
  return hueText(hueFor(field, value), 'light')
}
