// The concept vocabulary: the layers a note can describe, and the categories
// and describing words under them. One array drives three surfaces — the "@"
// menu's inline property tags (lib/propertyTags.ts), the elements block's grid
// (plugins/elements/), and both print documents — so retuning happens here and
// nowhere else.
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
// ladder (ppp–fff). The bank keeps every Italian marking in one pile; here they
// are split by the concept they belong to, so "@dolce" is Expression and
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
// `data-field` of every inline tag — so rename a label freely but never an id.

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
    id: 'pitch',
    color: '#f87171',
    label: 'Pitch',
    fields: [
      {
        id: 'pitch.contour',
        label: 'Melodic motion & contour',
        options: [
          'Angular',
          'Arc-shaped',
          'Ascending',
          'Conjunct',
          'Contour',
          'Contrary motion',
          'Descending',
          'Disjunct',
          'Florid',
          'Leap',
          'Parallel motion',
          'Sequence',
          'Sequential',
          'Similar motion',
          'Smooth',
          'Static',
          'Stepwise',
          'Virtuosic',
        ],
        allowCustom: true,
      },
      {
        id: 'pitch.range',
        label: 'Range & register',
        options: [
          'High register',
          'Limited range',
          'Low register',
          'Narrow range',
          'Register extremes',
          'Tessitura',
          'Wide range',
        ],
        allowCustom: true,
      },
      {
        id: 'pitch.tonality',
        label: 'Tonality',
        options: [
          'Bitonal',
          'Chromatic',
          'Chromaticism',
          'Diatonic',
          'Major',
          'Minor',
          'Modal',
          'Modality',
          'Modulating',
          'Picardy 3rd',
          'Polytonal',
          'Tierce de picardie',
          'Tonal',
          'Tonal ambiguity',
          'Tonal centre',
        ],
        allowCustom: true,
      },
      {
        id: 'pitch.scale',
        label: 'Scale / mode type',
        options: [
          'Aeolian',
          'Chromatic scale',
          'Dorian',
          'Harmonic minor',
          'Mixolydian',
          'Pentatonic',
          'Phrygian',
          'Scale-based',
          'Scalic',
          'Whole-tone',
        ],
        allowCustom: true,
      },
      {
        id: 'pitch.harmony',
        label: 'Harmony & chord quality',
        options: [
          'Arpeggiated',
          'Augmented',
          'Block chords',
          'Broken chords',
          'Diminished',
          'Drone',
          'Inverted',
          'Major 7',
          'Open 5ths',
          'Pedal point',
          'Quartal',
          'Resolution',
          'Resolved',
          'Root position',
          'Suspended',
          'Suspension',
          'Tonic-and-dominant based',
          'Triadic',
          'Unresolved',
        ],
        allowCustom: true,
      },
      {
        id: 'pitch.consonance',
        label: 'Consonance / dissonance',
        options: [
          'Cluster-like',
          'Clusters',
          'Consonant',
          'Dissonance',
          'Dissonant',
          'Semitone dissonance',
        ],
        allowCustom: true,
      },
      {
        id: 'pitch.cadence',
        label: 'Cadence type',
        options: ['Cadential', 'Imperfect', 'Perfect'],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'duration',
    color: '#eab308',
    label: 'Duration',
    fields: [
      {
        id: 'duration.tempo',
        label: 'Speed (tempo)',
        options: ['Fast', 'Lively', 'Quick', 'Rapid', 'Slow'],
        allowCustom: true,
      },
      {
        id: 'duration.tempoChange',
        label: 'Tempo change',
        options: ['Acceleration', 'Getting faster', 'Slowing'],
        allowCustom: true,
      },
      {
        id: 'duration.drive',
        label: 'Drive / momentum',
        options: [
          'Boisterous',
          'Busy',
          'Driving',
          'Energetic',
          'Momentum',
          'Perpetual',
          'Propelling',
          'Relentless',
          'Rhythmic drive',
        ],
        allowCustom: true,
      },
      {
        id: 'duration.steadiness',
        label: 'Steadiness / regularity',
        options: [
          'Balanced',
          'Consistent',
          'Constant',
          'Continuous',
          'Even',
          'Maintained',
          'Pervasive',
          'Regular',
          'Steady',
        ],
        allowCustom: true,
      },
      {
        id: 'duration.syncopation',
        label: 'Irregularity / syncopation',
        options: [
          'Ambiguous',
          'Cross-rhythm',
          'Displaced',
          'Hemiola',
          'Hemiolic',
          'Off-beat',
          'Polyrhythm',
          'Polyrhythmic',
          'Shifting',
          'Syncopated',
          'Uneven',
        ],
        allowCustom: true,
      },
      {
        id: 'duration.metre',
        label: 'Metre & metre changes',
        options: [
          'Changing metre',
          'Compound',
          'Duple',
          'Mixed metre',
          'Multimetric',
          'Quadruple',
          'Simple triple',
          'Triple',
        ],
        allowCustom: true,
      },
      {
        id: 'duration.values',
        label: 'Note-value character',
        options: [
          'Anacrusis',
          'Augmentation',
          'Augmented',
          'Diminution',
          'Dotted',
          'Duplet',
          'Long',
          'Quintuplet',
          'Sextuplet',
          'Short',
          'Shorter',
          'Snap',
          'Sustained',
          'Tied',
          'Triplet',
        ],
        allowCustom: true,
      },
      {
        id: 'duration.feel',
        label: 'Rhythmic feel & character',
        options: ['Chant-like', 'Dance-like', 'Lilting', 'March-like', 'Stamping', 'Warlike'],
        allowCustom: true,
      },
      {
        id: 'duration.italian',
        label: 'Tempo & rhythmic terms (Italian)',
        options: [
          'Accelerando',
          'Allegretto grazioso',
          'Allegro',
          'Allegro Vivace',
          'Animando',
          'Leggierissimo',
          'Lento',
          'Lento maestoso',
          'Maestoso',
          'Metric modulation',
          'Moto perpetuo',
          'Rallentando',
          'Ritardando',
          'Ritenuto',
          'Rubato',
          'Senza misura',
        ],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'dynamics',
    color: '#22c55e',
    label: 'Dynamics',
    fields: [
      {
        id: 'dynamics.volume',
        label: 'Dynamic level',
        options: ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'],
        allowCustom: true,
      },
      {
        id: 'dynamics.loudness',
        label: 'Loudness level',
        options: [
          'Forced',
          'Limited',
          'Loud',
          'Quiet',
          'Soft',
          'Softer',
          'Static (volume)',
          'Subtle',
          'Wide (dynamic range)',
        ],
        allowCustom: true,
      },
      {
        id: 'dynamics.change',
        label: 'Change in dynamics',
        options: [
          'Frequent',
          'Gradual',
          'Gradually',
          'Sudden',
          'Swelling',
          'Swells',
          'Terraced',
          'Varied',
        ],
        allowCustom: true,
      },
      {
        id: 'dynamics.italian',
        label: 'Dynamic markings (Italian)',
        options: [
          'Crescendo',
          'Decrescendo',
          'Diminuendo',
          'Dynamic letter levels (ppp–ff)',
          'Fortepiano (fp)',
          'Sforzando (sfz)',
          'Sfzp',
        ],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'expressive',
    color: '#84cc16',
    label: 'Expression',
    fields: [
      {
        id: 'expressive.articulation',
        label: 'Articulation',
        options: [
          'Accented',
          'Arco',
          'Detached',
          'Legato',
          'Marcato',
          'Pizzicato',
          'Slurred',
          'Slurs',
          'Staccatissimo',
          'Staccato',
          'Sustained',
          'Tenuto',
        ],
        allowCustom: true,
      },
      {
        id: 'expressive.technique',
        label: 'Special playing techniques',
        options: [
          'Bartók pizz.',
          'Col legno',
          'Glissandi',
          'Glissando',
          'Jeté bowing',
          'Laissez vibrer',
          'Slap tonguing',
          'Snap pizzicato',
          'Spiccato',
          'Sul ponticello',
          'Sul tasto',
          'Tremolo',
          'Trill',
          'Vibrato',
        ],
        allowCustom: true,
      },
      {
        id: 'expressive.phrasing',
        label: 'Phrasing & character',
        options: [
          'Animated (animando)',
          'Barbaric (feroce)',
          'Boisterous',
          'Delicate',
          'Dramatic',
          'Energetic',
          'Expressive',
          'Forceful',
          'Graceful',
          'Intense',
          'Languid',
          'Lyrical',
          'Majestic (maestoso)',
          'Playful',
          'Relentless',
          'Savage',
          'Sweet (dolce)',
          'Urgent',
        ],
        allowCustom: true,
      },
      {
        id: 'expressive.italian',
        label: 'Performance directions (Italian)',
        options: [
          '‘Breathing’ marks',
          'Ad libitum',
          'Cantabile',
          'Con forza',
          'Con sordino (mute)',
          'Delicatamente',
          'Dolce',
          'Espressivo',
          'Grazioso',
          'Leggierissimo',
          'Leggiero',
          'Semplice',
          'Senza misura',
          'Senza sordino',
          'Senza vibrato',
          'Sotto voce',
        ],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'media',
    color: '#60a5fa',
    label: 'Performing media',
    fields: [
      {
        id: 'media.instrument',
        label: 'Instrument / section',
        options: [
          'Brass',
          'Guitar',
          'Keyboard',
          'Percussion',
          'Strings',
          'Synth / electronic',
          'Voice',
          'Woodwind',
        ],
        allowCustom: true,
      },
      {
        id: 'media.ensemble',
        label: 'Ensemble / forces',
        options: [
          'A cappella',
          'Big band',
          'Chamber ensemble',
          'Choir',
          'Concert band',
          'Duet',
          'Orchestra',
          'Quartet',
          'Quintet',
          'Rock band',
          'Solo',
          'String orchestra',
          'Trio',
          'Vocal ensemble',
        ],
        allowCustom: true,
      },
      {
        id: 'media.production',
        label: 'Sound produced by',
        options: ['Blowing', 'Bowing', 'Electronic', 'Plucking', 'Singing', 'Striking'],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'timbre',
    color: '#22d3ee',
    label: 'Timbre',
    fields: [
      {
        id: 'timbre.bright',
        label: 'Bright / brilliant',
        options: [
          'Bright',
          'Brilliant',
          'Clear',
          'Crisp',
          'Glittering',
          'Ringing',
          'Shimmering',
          'Sparkling',
          'Vibrant',
        ],
        allowCustom: true,
      },
      {
        id: 'timbre.warm',
        label: 'Warm / mellow / smooth',
        options: [
          'Cantabile',
          'Ethereal',
          'Even',
          'Floating',
          'Fluid',
          'Gentle',
          'Lyrical',
          'Mellow',
          'Sweet',
          'Warm',
        ],
        allowCustom: true,
      },
      {
        id: 'timbre.dark',
        label: 'Dark / dull / heavy',
        options: ['Dark', 'Dull', 'Heavy', 'Hollow', 'Muted', 'Subdued'],
        allowCustom: true,
      },
      {
        id: 'timbre.harsh',
        label: 'Harsh / strident / forceful',
        options: [
          'Acute',
          'Brittle',
          'Forceful',
          'Harsh',
          'Intense',
          'Relentless',
          'Strident',
        ],
        allowCustom: true,
      },
      {
        id: 'timbre.material',
        label: 'Material / sound-source',
        options: [
          'Bell-like',
          'Dry',
          'Echoey',
          'Metallic',
          'Nasal',
          'Percussive',
          'Resonant',
          'Wooden',
          'Woody',
        ],
        allowCustom: true,
      },
      {
        id: 'timbre.mood',
        label: 'Mood / character',
        options: ['Delicate', 'Dramatic', 'Eerie', 'Languid', 'Playful'],
        allowCustom: true,
      },
      {
        id: 'timbre.density',
        label: 'Density',
        options: ['Full', 'Homogenous', 'Light', 'Rich', 'Thin', 'Transparent'],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'texture',
    color: '#a78bfa',
    label: 'Texture',
    fields: [
      {
        id: 'texture.type',
        label: 'Texture type',
        options: ['Contrapuntal', 'Homophonic', 'Monophonic', 'Polyphonic', 'Polyphony'],
        allowCustom: true,
      },
      {
        id: 'texture.role',
        label: 'Layer role',
        options: [
          'Accompaniment',
          'Bass line',
          'Counter-melody',
          'Melody',
          'Pad / drone',
          'Rhythmic',
        ],
        allowCustom: true,
      },
      {
        id: 'texture.layers',
        label: 'Layer relationship & count',
        options: [
          'Block (chordal)',
          'Dialogue',
          'Doubled',
          'Doubling',
          'Independent',
          'Interplay',
          'Layered',
          'Layers',
          'Single line',
          'Unison (as texture)',
        ],
        allowCustom: true,
      },
      {
        id: 'texture.density',
        label: 'Density',
        options: [
          'Busy',
          'Complex',
          'Dense',
          'Density',
          'Full',
          'Light',
          'Lighter',
          'Rich',
          'Sparse',
          'Thick',
          'Thicken',
          'Thin',
        ],
        allowCustom: true,
      },
      {
        id: 'texture.devices',
        label: 'Compositional-device textures',
        options: [
          'Antiphonal',
          'Canon',
          'Canonic',
          'Countermelody',
          'Fugal',
          'Fugue-like',
          'Hocket',
          'Imitation',
          'Imitative',
          'Interlocking',
          'Staggered entries',
        ],
        allowCustom: true,
      },
    ],
  },
  {
    id: 'structure',
    color: '#f97316',
    label: 'Structure',
    fields: [
      {
        id: 'structure.phrase',
        label: 'Phrase & form shape',
        options: [
          'Arc-shaped',
          'Arch',
          'Cadenza',
          'Call-and-response',
          'Climactic',
          'Climax',
          'Coda',
          'Codetta',
          'Question-and-answer',
          'Sectional',
          'Sections',
          'Theme and variations',
          'Through-composed',
        ],
        allowCustom: true,
      },
      {
        id: 'structure.repetition',
        label: 'Repetition & recurring material',
        options: ['Echoed', 'Mirrored', 'Ostinato', 'Recurring', 'Repeated', 'Repetition'],
        allowCustom: true,
      },
      {
        id: 'structure.development',
        label: 'Development of ideas',
        options: [
          'Augmented',
          'Developed',
          'Development',
          'Diminution',
          'Elaborated',
          'Extended',
          'Extension',
          'Fragmentation',
          'Fragmented',
          'Inversion',
          'Inverted',
          'Motif',
          'Motivic',
          'Sequence',
          'Sequential',
        ],
        allowCustom: true,
      },
      {
        id: 'structure.imitation',
        label: 'Imitative / canonic devices',
        options: [
          'Antiphonal',
          'Canon',
          'Canonic',
          'Fugal',
          'Fugue-like',
          'Imitation',
          'Imitative',
          'Staggered',
        ],
        allowCustom: true,
      },
      {
        id: 'structure.contrast',
        label: 'Contrast / variety',
        options: [
          'Alternating',
          'Contrasting',
          'Juxtaposed',
          'Variation',
          'Varied',
          'Variety',
        ],
        allowCustom: true,
      },
      {
        id: 'structure.unity',
        label: 'Unity / cohesion',
        options: ['Consistent', 'Return', 'Returning', 'Unified', 'Unifying', 'Unity'],
        allowCustom: true,
      },
      {
        id: 'structure.balance',
        label: 'Balance & symmetry',
        options: ['Balance', 'Balanced', 'Even phrase length', 'Symmetrical'],
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
