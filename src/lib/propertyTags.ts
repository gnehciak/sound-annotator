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
import { ALIASES, AUTO_TERMS } from './vocabulary.generated'
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

/**
 * Every value in the taxonomy, flattened once — the concepts first, then the
 * layers.
 *
 * Order decides ties, and four words are in both: Melody, Harmony, Bass and
 * Rhythm are layer roles *and* concept vocabulary. The concept has to win,
 * because "the rhythm is syncopated" is about Duration, not about which line
 * of the texture is being described — Layer is a synthetic category serving
 * the elements block, not a reading of the sentence. This also puts the flat
 * list in the same order as the dictionary (VOCAB_CATEGORIES), which has
 * always listed Layer last.
 */
const ALL: PropertyOption[] = [
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
  ...LAYERS.map((l) => ({
    key: `${LAYER_FIELD}:${l.id}`,
    field: LAYER_FIELD,
    category: 'Layer',
    fieldLabel: 'Layer',
    value: l.label,
    color: l.color,
  })),
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
 * The list is the **Auto-tag tick** in the Notion Terms database, and it is an
 * allowlist on purpose: it holds only terms you would essentially never type
 * in a music note in their everyday sense. "Legato", "hemiola" and
 * "monophonic" can fire on sight; "even", "light", "full", "clear", "return"
 * and "major" cannot, because a sentence about music uses those as ordinary
 * English several times a paragraph and a chip must not land in the middle of
 * one. Dynamic letters (p, f, ff…) are out for the same reason, only more so.
 *
 * It fails closed: a word added to the vocabulary does not start auto-firing
 * until someone ticks it. Tick a row in Notion to widen it — never here, since
 * this file no longer holds the list.
 */

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
const CANONICAL = [...BY_VALUE.keys()].filter(
  (v) => v.length > 1 && !v.includes('('),
)

// ---------------------------------------------------------------------------
// The other forms of the word
// ---------------------------------------------------------------------------
//
// A note says "the syncopation drives it" as readily as "syncopated", and the
// bank happens to hold one and not the other — arbitrarily, since it also
// holds both Hemiola and Hemiolic. So the regular English forms are generated
// rather than listed, and the irregular ones (Italian plurals, abbreviations,
// spelling variants) are the job of the Aliases column in Notion.
//
// **Only terms of art get inflected**, and that is the whole safety argument.
// Deriving from every value would put "evening" in front of the reader as a
// form of "Even", and "lighting" as a form of "Light" — words a sentence about
// music uses in their ordinary sense constantly. A word already marked
// unmistakable enough to tag itself (AUTO_INDEX) is unmistakable in its
// inflections too; a word that is ordinary English in its base form is
// ordinary English in all of them. The judgment call is one that has already
// been made, so this reuses it rather than inventing a second list.
//
// Derived forms are for the *underline only*. Auto-tagging stays exact — the
// input rule rewrites a sentence as you type, so a wrong guess there costs
// real damage, while a wrong underline costs a dotted line you ignore. That is
// the same asymmetry AUTO_TERMS and the suggestion layer already run on.

const ACCENTLESS = (w: string) =>
  w.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC')

/** Regular English (and Italian-plural) forms of one word. */
function inflectWord(w: string): string[] {
  const out: string[] = []
  const add = (...xs: string[]) => out.push(...xs)

  // Plurals.
  if (/(s|x|z|ch|sh)$/.test(w)) add(w + 'es')
  else if (/[^aeiou]y$/.test(w)) add(w.slice(0, -1) + 'ies')
  else add(w + 's')
  // Italian, both ways: ostinato/ostinati, glissandi/glissando.
  if (w.endsWith('o')) add(w.slice(0, -1) + 'i')
  if (w.endsWith('i')) add(w.slice(0, -1) + 'o')

  // Verb forms. Consonant doubling (stopped, running) is deliberately not
  // attempted — it needs stress rules, and guessing wrong invents a word.
  if (w.endsWith('e')) add(w.slice(0, -1) + 'ed', w.slice(0, -1) + 'ing')
  else if (!w.endsWith('ed')) add(w + 'ed', w + 'ing')

  // Nominalisations and the adjective/noun pairs music writing lives on.
  const nominal = w.replace(/at(e|ed|ing)$/, 'ation')
  if (nominal !== w) add(nominal)
  if (w.endsWith('ic')) add(w.slice(0, -2) + 'y', w + 'ally')
  if (/[^aeiou]y$/.test(w)) add(w.slice(0, -1) + 'ic')
  if (w.endsWith('al')) add(w + 'ity', w + 'ly')

  // …and the same pairs read backwards, since which form the bank happens to
  // hold is arbitrary: it lists Accented but not "accent", Imitation but not
  // "imitates". Stripping a suffix can leave a non-word ("hemiol"), which is
  // harmless — nobody types it, so it is an index key that never matches.
  const bases: string[] = []
  if (w.endsWith('ed')) bases.push(w.slice(0, -2), w.slice(0, -1))
  if (w.endsWith('ing')) bases.push(w.slice(0, -3), w.slice(0, -3) + 'e')
  if (w.endsWith('ion')) bases.push(w.slice(0, -3) + 'e')
  if (w.endsWith('ic')) bases.push(w.slice(0, -2))
  // Singulars, for the terms the bank holds in the plural — Cymbals, Claves,
  // Clusters, Slurs. "Bass" losing its s is junk nobody types, which is the
  // usual harmless case.
  if (w.endsWith('es')) bases.push(w.slice(0, -2))
  if (w.endsWith('s')) bases.push(w.slice(0, -1))
  for (const b of bases) if (b.length > 2) add(b, b + 's', b + 'es')

  return out
}

/** Every extra spelling one value should be recognised by. */
function formsOf(value: string): string[] {
  const v = value.toLowerCase()
  const forms = new Set<string>()
  // Inflect the last word only: "high register" pluralises its noun.
  const head = v.slice(0, v.lastIndexOf(' ') + 1)
  const tail = v.slice(head.length)
  for (const f of inflectWord(tail)) forms.add(head + f)
  // Punctuation the writer may or may not reach for.
  if (v.includes('-')) forms.add(v.replace(/-/g, ' ')).add(v.replace(/-/g, ''))
  const plain = ACCENTLESS(v)
  if (plain !== v) forms.add(plain)
  return [...forms]
}

/**
 * A derived spelling → the option it stands for. Never shadows a canonical
 * value (a real term always wins its own word), and first writer wins where
 * two terms of art inflect onto the same string.
 */
const LOOSE_INDEX = new Map<string, PropertyOption>()
// Notion's Aliases column first: it carries the forms no rule reaches — Italian
// plurals, abbreviations, variant spellings — and an explicit answer outranks a
// derived one where the two ever collide.
for (const [alias, value] of Object.entries(ALIASES)) {
  const option = BY_VALUE.get(value.toLowerCase())?.[0]
  const key = alias.toLowerCase()
  if (option && !BY_VALUE.has(key)) LOOSE_INDEX.set(key, option)
}
for (const option of AUTO_INDEX.values()) {
  for (const form of formsOf(option.value)) {
    if (form.length < 2 || BY_VALUE.has(form) || LOOSE_INDEX.has(form)) continue
    LOOSE_INDEX.set(form, option)
  }
}

const SUGGESTABLE = [...CANONICAL, ...LOOSE_INDEX.keys()]
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
    const key = m[0].toLowerCase()
    const loose = LOOSE_INDEX.get(key)
    const options = BY_VALUE.get(key) ?? (loose ? [loose] : undefined)
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

/**
 * The concept-by-concept scaffold the note's Template action writes: each of
 * the eight concepts, in the order the dictionary lists them, named by its own
 * `Element name` value. Pairs are [field, value] so the chip is a real tag.
 */
export const ANALYSIS_TEMPLATE: [string, string][] = ELEMENTS.flatMap((cat) => {
  const field = cat.fields.find((f) => f.id.endsWith('.element'))
  // The field's options are alphabetical, so ask for the concept's own name
  // rather than taking the first — "Pitch", not "Melodic".
  const value = field?.options.find((o) => o === cat.label)
  return field && value ? [[field.id, value] as [string, string]] : []
})

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
