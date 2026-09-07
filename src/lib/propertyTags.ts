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
 * Values matching a "@" query, best-first. A query hits on the value, the field
 * label, or the category label — so "@rising" finds the one contour, while
 * "@pitch" opens the whole Pitch category, which is what makes a category name
 * a usable thing to type.
 */
export function searchProperties(query: string, limit = 8): PropertyOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return ALL.slice(0, limit)
  const scored: { opt: PropertyOption; score: number }[] = []
  for (const opt of ALL) {
    const value = opt.value.toLowerCase()
    let score = -1
    if (value.startsWith(q)) score = 0
    else if (value.includes(q)) score = 1
    else if (opt.category.toLowerCase().startsWith(q)) score = 2
    else if (opt.fieldLabel.toLowerCase().includes(q)) score = 3
    else if (opt.category.toLowerCase().includes(q)) score = 4
    if (score >= 0) scored.push({ opt, score })
  }
  scored.sort((a, b) => a.score - b.score)
  return scored.slice(0, limit).map((s) => s.opt)
}

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
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    white-space: nowrap;
    border: 1px solid var(--hue-ink, #57534e);
    border-radius: 4px;
    padding: 0 4px;
    margin: 0 1px;
    font-size: 11px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .prop-tag-cat {
    font: 600 8px/1.6 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--hue-ink, #57534e);
  }
  .prop-tag-val { color: #241f1b; }
`

/** The AA-safe ink a chip's category label and border wear on white paper. */
export function inkFor(field: string, value: string): string {
  return hueText(hueFor(field, value), 'light')
}
