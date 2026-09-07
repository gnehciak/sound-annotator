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

export const ELEMENTS: ElementCategory[] = [
  {
    id: 'timbre',
    color: '#ffd633',
    label: 'Timbre',
    fields: [
      {
        id: 'timbre.instrument',
        label: 'Instrument / section',
        options: ['Strings', 'Woodwind', 'Brass', 'Percussion', 'Keyboard', 'Guitar', 'Voice', 'Synth / electronic'],
        allowCustom: true,
      },
      {
        id: 'timbre.quality',
        // Id stays `timbre.quality` — it's the key stored on every note that
        // already set this; only the display label moved off "Timbre" when
        // the category took that name.
        label: 'Tone quality',
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
    color: '#2dd4bf',
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
    color: '#a06bff',
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
    color: '#5aa8ff',
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
    color: '#f472b6',
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
  {
    id: 'expressive',
    color: '#3ddc74',
    label: 'Expressive techniques',
    fields: [
      {
        id: 'expressive.articulation',
        label: 'Articulation',
        options: ['Legato', 'Staccato', 'Accent', 'Marcato', 'Tenuto', 'Slurred', 'Detached'],
        allowCustom: true,
      },
      {
        id: 'expressive.ornament',
        label: 'Ornamentation',
        options: ['Trill', 'Grace note', 'Mordent', 'Turn', 'Glissando', 'Portamento', 'Bend'],
        allowCustom: true,
      },
      {
        id: 'expressive.technique',
        label: 'Performance technique',
        options: [
          'Vibrato',
          'Tremolo',
          'Pizzicato',
          'Arco',
          'Muted / con sordino',
          'Harmonics',
          'Flutter-tongue',
          'Palm mute',
          'Falsetto',
        ],
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
