// The concept vocabulary: the layers a note can describe, and the categories
// and describing words under them. One array drives three surfaces — the "@"
// menu's inline property tags (lib/propertyTags.ts), the elements block's grid
// (plugins/elements/), and both print documents.
//
// This module owns the *types* and the helpers. The words themselves live in
// vocabulary.generated.ts, synced from Notion — see `npm run sync:vocab`.
//
// The words are the marking-guideline vocabulary from the owner's "Concept
// vocabulary" bank (HSC & Trial sample answers), which is why the categories
// are the six NSW concepts of music rather than a generic elements grid, and
// why the option lists read as describing words ("shimmering", "hemiola",
// "terraced") rather than a tick-box taxonomy. Terms the bank writes as
// alternatives ("slurred / slurs") are split into one option each, so every
// word is its own chip and its own search hit.
//
// A few lists are ours, not the bank's, because a bank of describing words has
// no equivalent: the performing-media lists, Layer role, and the Dynamic level
// ladder (ppp–fff). The bank keeps every Italian marking in one pile; the sync
// splits it by the concept it belongs to, so "@dolce" is Expression and
// "@cresc" is Dynamics.
//
// Category hues follow the owner's concept nav. That nav pairs Dynamics with
// Expression and Performing media with Timbre, so each pair shares a colour
// family (lime beside green, cyan beside blue) — near enough to read as a
// pair, far enough apart to tell two chips apart at a glance. Red, blue and
// violet are a step lighter than the nav's mid-tones: dark is the default
// canvas here, and at full strength those three read under 4.5:1 on it.
//
// Field ids are stored data — they are the keys of ElementsData.fields and the
// `data-field` of every inline tag — so rename a label freely, and an id only
// after checking the database says nothing stores it.

// Type-only in the other direction, so the pair does not form a runtime cycle.
import { ELEMENTS } from './vocabulary.generated'

/** A single dropdown within an element category. */
export interface ElementField {
  /** Namespaced, globally-unique id; stored as a key in ElementsData.fields. */
  id: string
  label: string
  options: string[]
  /** Allow a free-typed "Other…" value when no option fits. */
  allowCustom?: boolean
}

/** An element category (a group of related dropdowns). */
export interface ElementCategory {
  id: string
  label: string
  /** Note-palette hue, worn by this category's inline property tags. */
  color: string
  fields: ElementField[]
}

/** An instrumental layer — the note's identity when it carries elements. */
export interface Layer {
  id: string
  label: string
  /** Note-palette hue; identity only, always paired with the label. */
  color: string
}

/** Payload stored on an `elements` block. */
export interface ElementsData {
  /** Layer id (see LAYERS); the note's headline identity. */
  layer?: string
  /** Field id → selected value. Empty/absent keys mean "not set". */
  fields: Record<string, string>
}

export const LAYERS: Layer[] = [
  { id: 'melody', label: 'Melody', color: '#5aa8ff' },
  { id: 'harmony', label: 'Harmony', color: '#2dd4bf' },
  { id: 'bass', label: 'Bass', color: '#a06bff' },
  { id: 'rhythm', label: 'Rhythm', color: '#ff9f2e' },
]

/**
 * The concept vocabulary itself — generated from the Notion word bank by
 * `npm run sync:vocab` (scripts/sync-vocabulary.mjs), which is also where the
 * categories, their colours, their field order and the lists the bank has no
 * equivalent for are configured. Edit those there, the words in Notion, and
 * never `vocabulary.generated.ts` by hand.
 */
export { ELEMENTS }

const LAYER_BY_ID = new Map(LAYERS.map((l) => [l.id, l]))

/** Resolve a layer id to its definition. */
export function layerOf(id?: string): Layer | undefined {
  return id ? LAYER_BY_ID.get(id) : undefined
}

/** Categories that have at least one field set in this data. */
export function categoriesPresent(data: ElementsData): ElementCategory[] {
  return ELEMENTS.filter((cat) => cat.fields.some((f) => data.fields[f.id]))
}

/** Selected values in schema order (skipping empties) — for the spec line. */
export function summarizeElements(data: ElementsData): string {
  const parts: string[] = []
  for (const cat of ELEMENTS) {
    for (const f of cat.fields) {
      const v = data.fields[f.id]
      if (v) parts.push(v)
    }
  }
  return parts.join(' · ')
}
