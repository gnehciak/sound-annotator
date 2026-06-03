// Taxonomy for the "musical elements" note plugin: the layers a note can
// describe, and the element categories with their dropdown fields. This is the
// single place to retune the vocabulary — add an instrument or a contour by
// editing one array; the editor UI is generated from it.
//
// NOTE: the option lists below are sensible defaults; adjust them to match your
// own listening worksheet. The structure (categories, fields, layers) mirrors
// the classic elements-of-music grid.

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
  { id: 'melody', label: 'Melody', color: '#5aa8e6' },
  { id: 'harmony', label: 'Harmony', color: '#3bb6a6' },
  { id: 'bass', label: 'Bass', color: '#a07bf0' },
  { id: 'rhythm', label: 'Rhythm', color: '#ef8b4b' },
]

export const ELEMENTS: ElementCategory[] = [
  {
    id: 'timbre',
    label: 'Tone colour',
    fields: [
      {
        id: 'timbre.instrument',
        label: 'Instrument / section',
        options: ['Strings', 'Woodwind', 'Brass', 'Percussion', 'Keyboard', 'Guitar', 'Voice', 'Synth / electronic'],
        allowCustom: true,
      },
      {
        id: 'timbre.quality',
        label: 'Timbre',
        options: ['Bright', 'Warm', 'Mellow', 'Harsh', 'Nasal', 'Breathy', 'Rich', 'Thin'],
        allowCustom: true,
      },
      {
        id: 'timbre.production',
        label: 'Sound produced by',
        options: ['Bowing', 'Plucking', 'Striking', 'Blowing', 'Singing', 'Electronic'],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'texture',
    label: 'Texture',
    fields: [
      {
        id: 'texture.role',
        label: 'Layer role',
        options: ['Melody', 'Counter-melody', 'Accompaniment', 'Bass line', 'Pad / drone', 'Rhythmic'],
        allowCustom: true,
      },
      {
        id: 'texture.density',
        label: 'Layer density',
        options: ['Sparse', 'Moderate', 'Dense'],
      },
    ],
  },
  {
    id: 'duration',
    label: 'Duration',
    fields: [
      {
        id: 'duration.values',
        label: 'Note lengths / values',
        options: ['Long / sustained', 'Short / detached', 'Mixed', 'Even', 'Dotted / syncopated'],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'pitch',
    label: 'Pitch',
    fields: [
      {
        id: 'pitch.type',
        label: 'Melodic / harmonic type',
        options: ['Conjunct (stepwise)', 'Disjunct (leaps)', 'Arpeggiated', 'Scalic', 'Chordal', 'Drone'],
        allowCustom: true,
      },
      {
        id: 'pitch.contour',
        label: 'Melodic / harmonic contour',
        options: ['Rising', 'Falling', 'Arch', 'Wave', 'Static', 'Undulating'],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'dynamics',
    label: 'Dynamics',
    fields: [
      {
        id: 'dynamics.volume',
        label: 'Volume of layer',
        options: ['pp', 'p', 'mp', 'mf', 'f', 'ff', 'Crescendo', 'Diminuendo'],
        allowCustom: true,
      },
    ],
  },
]

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
