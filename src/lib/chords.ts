// The chord engine behind the structure board's Chords player. Three layers,
// all pure and UI-free:
//
//  1. Chord symbols → guitar shapes. `parseChord` reads a chord name
//     ("F#m7", "Bb", "Dsus4", "G/B"); `shapeFor` resolves it to a playable
//     fretting — an open-position dictionary for the canonical cowboy chords,
//     movable E/A/D-form shapes (with auto-derived textbook fingering) for
//     everything else, and a nearest-parent fallback for exotic extensions
//     ("Cmadd9" renders the Cm shape, flagged `exact: false`).
//
//  2. The beat grid. A structure project stores `bpm`, `beatsPerBar`, and
//     `beatOffset` (the time of beat 1) in its settings; `makeGrid` turns
//     those into beat↔seconds math shared by the lane, the readout, and the
//     event builder.
//
//  3. Progressions → a chord-event timeline. Each section annotation carries
//     a `chords` string in chart notation ("Am | F | C G"); bars are split on
//     `|`, chords inside a bar divide it evenly, `.` holds the previous
//     chord, and a progression shorter than its section LOOPS to fill it —
//     type a 4-bar pattern once and the whole verse is covered.
import type { Annotation } from '../types'
import { sortedSections } from './sections'

// ---- chord symbols ---------------------------------------------------------

export interface ParsedChord {
  /** The symbol as typed (trimmed) — always what the UI displays. */
  name: string
  /** Pitch class of the root, C = 0 … B = 11. */
  pc: number
  /** Resolved shape-quality key (see SHAPE_QUALITIES). */
  quality: string
  /** False when the quality fell back to a parent ("add9" → major). */
  exact: boolean
  /** Slash-chord bass, display only ("G/B" → "B"). */
  bass?: string
}

const PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/** Exact quality spellings → shape key. Case matters ("M7" ≠ "m7"). */
const QUALITY: Record<string, string> = {
  '': 'maj', maj: 'maj', M: 'maj', major: 'maj',
  m: 'min', min: 'min', '-': 'min', minor: 'min',
  '7': '7', dom7: '7',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  maj7: 'maj7', M7: 'maj7', ma7: 'maj7', Δ7: 'maj7', Δ: 'maj7',
  sus: 'sus4', sus4: 'sus4', sus2: 'sus2',
  '7sus4': '7sus4', '7sus': '7sus4',
  dim: 'dim7', '°': 'dim7', o: 'dim7', dim7: 'dim7', '°7': 'dim7', o7: 'dim7',
  aug: 'aug', '+': 'aug',
  '5': '5', '9': '9',
  m7b5: 'm7b5', 'm7♭5': 'm7b5', ø: 'm7b5', ø7: 'm7b5',
}

/** Longest-prefix fallbacks for extensions we don't draw natively. */
const QUALITY_FALLBACK: [string, string][] = [
  ['maj9', 'maj7'], ['maj13', 'maj7'], ['ma9', 'maj7'], ['M9', 'maj7'],
  ['m11', 'm7'], ['m13', 'm7'], ['m9', 'm7'], ['m6', 'min'], ['madd', 'min'],
  ['min', 'min'], ['m', 'm7'],
  ['13', '7'], ['11', '7'], ['9', '9'], ['7', '7'], ['69', 'maj'], ['6', 'maj'],
  ['add', 'maj'], ['sus2', 'sus2'], ['sus', 'sus4'], ['dim', 'dim7'],
  ['aug', 'aug'], ['+', 'aug'], ['maj', 'maj'], ['M', 'maj'],
]

/** Parse a chord symbol; null when it doesn't even start with a note name. */
export function parseChord(raw: string): ParsedChord | null {
  const name = raw.trim()
  const m = /^([A-Ga-g])([#♯b♭]?)(.*)$/.exec(name)
  if (!m) return null
  let pc = PC[m[1].toLowerCase()]
  if (m[2] === '#' || m[2] === '♯') pc = (pc + 1) % 12
  else if (m[2] === 'b' || m[2] === '♭') pc = (pc + 11) % 12
  let rest = m[3].trim()
  let bass: string | undefined
  const slash = /^(.*?)\s*\/\s*([A-Ga-g][#♯b♭]?)$/.exec(rest)
  if (slash) {
    rest = slash[1].trim()
    bass = slash[2][0].toUpperCase() + (slash[2][1] ?? '')
  }
  if (rest in QUALITY)
    return { name, pc, quality: QUALITY[rest], exact: true, bass }
  const fb = QUALITY_FALLBACK.find(([p]) => rest.startsWith(p))
  return { name, pc, quality: fb?.[1] ?? 'maj', exact: false, bass }
}

// ---- shapes ----------------------------------------------------------------

export interface Barre {
  /** Absolute fret. */
  fret: number
  /** Inclusive string span, 0 = low E … 5 = high e. */
  from: number
  to: number
  finger: number
}

export interface ChordShape {
  /** Absolute fret per string, low E → high e; null = muted, 0 = open. */
  frets: (number | null)[]
  /** Finger per string (1–4); 0 = open, muted, or covered by a barre. */
  fingers: number[]
  barres: Barre[]
  /** First displayed fret. 1 = the nut is in view; else label "Nfr". */
  position: number
}

interface OpenShape {
  frets: (number | null)[]
  fingers: number[]
  barres?: Barre[]
}

/** Canonical open-position chords, keyed `pc:quality`. Textbook fingerings. */
const OPEN: Record<string, OpenShape> = {
  // C (pc 0)
  '0:maj': { frets: [null, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0] },
  '0:7': { frets: [null, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0] },
  '0:maj7': { frets: [null, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0] },
  // D (pc 2)
  '2:maj': { frets: [null, null, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2] },
  '2:min': { frets: [null, null, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1] },
  '2:7': { frets: [null, null, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3] },
  '2:m7': {
    frets: [null, null, 0, 2, 1, 1],
    fingers: [0, 0, 0, 2, 0, 0],
    barres: [{ fret: 1, from: 4, to: 5, finger: 1 }],
  },
  '2:maj7': {
    frets: [null, null, 0, 2, 2, 2],
    fingers: [0, 0, 0, 0, 0, 0],
    barres: [{ fret: 2, from: 3, to: 5, finger: 1 }],
  },
  '2:sus2': { frets: [null, null, 0, 2, 3, 0], fingers: [0, 0, 0, 1, 3, 0] },
  '2:sus4': { frets: [null, null, 0, 2, 3, 3], fingers: [0, 0, 0, 1, 3, 4] },
  // E (pc 4)
  '4:maj': { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0] },
  '4:min': { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0] },
  '4:7': { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0] },
  '4:m7': { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0] },
  '4:maj7': { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0] },
  '4:sus4': { frets: [0, 2, 2, 2, 0, 0], fingers: [0, 2, 3, 4, 0, 0] },
  // F (pc 5) — only the pretty maj7; F itself is the E-form barre at 1.
  '5:maj7': { frets: [null, null, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0] },
  // G (pc 7)
  '7:maj': { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3] },
  '7:7': { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1] },
  // A (pc 9)
  '9:maj': { frets: [null, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0] },
  '9:min': { frets: [null, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0] },
  '9:7': { frets: [null, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0] },
  '9:m7': { frets: [null, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0] },
  '9:maj7': { frets: [null, 0, 2, 1, 2, 0], fingers: [0, 0, 2, 1, 3, 0] },
  '9:sus2': { frets: [null, 0, 2, 2, 0, 0], fingers: [0, 0, 1, 2, 0, 0] },
  '9:sus4': { frets: [null, 0, 2, 2, 3, 0], fingers: [0, 0, 1, 2, 3, 0] },
  // B (pc 11)
  '11:7': { frets: [null, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4] },
}

interface MovableForm {
  /** Which string carries the root: array index 0 = low E, 1 = A, 2 = D. */
  rootString: 0 | 1 | 2
  /** The root's fret offset inside the shape (usually 0). */
  rootOffset: number
  /** Fret offsets per string from the shape's base fret; null = muted. */
  offsets: (number | null)[]
  /** Whether offset-0 strings are covered by a full first-finger barre. */
  barre: boolean
  /** Optional hand-tuned fingering (overrides the auto-derivation). */
  fingers?: number[]
}

/** Open-string pitch class of each root string (low E, A, D). */
const ROOT_PC = [4, 9, 2] as const

/** Movable forms per quality, in preference order (lowest position wins). */
const MOVABLE: Record<string, MovableForm[]> = {
  maj: [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 2, 1, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 2, 2, 0], barre: true },
  ],
  min: [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 2, 0, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 2, 1, 0], barre: true },
  ],
  '7': [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 0, 1, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 0, 2, 0], barre: true },
  ],
  m7: [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 0, 0, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 0, 1, 0], barre: true },
  ],
  maj7: [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 1, 1, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 1, 2, 0], barre: true },
  ],
  sus2: [
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 2, 0, 0], barre: true },
  ],
  sus4: [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 2, 2, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 2, 3, 0], barre: true },
  ],
  '7sus4': [
    { rootString: 0, rootOffset: 0, offsets: [0, 2, 0, 2, 0, 0], barre: true },
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 2, 0, 3, 0], barre: true },
  ],
  '9': [
    { rootString: 1, rootOffset: 1, offsets: [null, 1, 0, 1, 1, 1], barre: false },
  ],
  m7b5: [
    { rootString: 1, rootOffset: 0, offsets: [null, 0, 1, 0, 1, null], barre: false },
  ],
  dim7: [
    { rootString: 2, rootOffset: 0, offsets: [null, null, 0, 1, 0, 1], barre: false },
  ],
  aug: [
    {
      rootString: 1,
      rootOffset: 2,
      offsets: [null, 2, 1, 0, 0, null],
      barre: false,
      fingers: [0, 4, 3, 1, 2, 0],
    },
  ],
  '5': [
    {
      rootString: 0,
      rootOffset: 0,
      offsets: [0, 2, 2, null, null, null],
      barre: false,
      fingers: [1, 3, 4, 0, 0, 0],
    },
    {
      rootString: 1,
      rootOffset: 0,
      offsets: [null, 0, 2, 2, null, null],
      barre: false,
      fingers: [0, 1, 3, 4, 0, 0],
    },
  ],
}

/**
 * Derive a textbook fingering for a movable form: the full barre (when the
 * form has one) is finger 1; remaining fretted strings take fingers by fret
 * offset (+1 → 2, +2 → 3, +3 → 4, bumping on collision), which reproduces the
 * standard fingerings for the E/A barre families; an adjacent run of ≥3
 * strings on one fret collapses into a mini-barre (the A-form's ring-finger
 * bar, the 9-shape's triple).
 */
function fingerForm(form: MovableForm, position: number): {
  fingers: number[]
  barres: Barre[]
} {
  const fingers = new Array<number>(6).fill(0)
  const barres: Barre[] = []
  if (form.fingers) {
    form.fingers.forEach((f, i) => (fingers[i] = f))
    if (form.barre) {
      const spanned = form.offsets
        .map((o, i) => (o != null ? i : -1))
        .filter((i) => i >= 0)
      barres.push({
        fret: position,
        from: spanned[0],
        to: spanned[spanned.length - 1],
        finger: 1,
      })
    }
    return { fingers, barres }
  }

  const used = new Set<number>()
  if (form.barre) {
    const spanned = form.offsets
      .map((o, i) => (o != null ? i : -1))
      .filter((i) => i >= 0)
    barres.push({
      fret: position,
      from: spanned[0],
      to: spanned[spanned.length - 1],
      finger: 1,
    })
    used.add(1)
  }

  // Fingered strings (in a barre form, offset-0 strings belong to the barre;
  // without one they're fretted individually), as adjacent same-offset runs.
  const runs: { offset: number; from: number; to: number }[] = []
  for (let s = 0; s < 6; s++) {
    const o = form.offsets[s]
    if (o == null || (form.barre && o <= 0)) continue
    const prev = runs[runs.length - 1]
    if (prev && prev.offset === o && prev.to === s - 1) prev.to = s
    else runs.push({ offset: o, from: s, to: s })
  }
  runs.sort((a, b) => a.offset - b.offset || a.from - b.from)
  const nextFree = (want: number) => {
    let f = Math.max(want, form.barre ? 2 : 1)
    while (used.has(f) && f < 4) f++
    used.add(f)
    return f
  }
  for (const run of runs) {
    const want = form.barre ? Math.min(run.offset + 1, 4) : 1
    if (run.to - run.from >= 2) {
      // A run of 3+ collapses into a mini-barre (the A-form's ring bar).
      barres.push({
        fret: position + run.offset,
        from: run.from,
        to: run.to,
        finger: nextFree(want),
      })
    } else {
      for (let s = run.from; s <= run.to; s++) fingers[s] = nextFree(want)
    }
  }
  return { fingers, barres }
}

/**
 * Resolve a parsed chord to a drawable shape: the open dictionary first, then
 * the lowest-position movable form. Every known quality has a form, so this
 * only returns null for a null parse.
 */
export function shapeFor(chord: ParsedChord | null): ChordShape | null {
  if (!chord) return null
  const open = OPEN[`${chord.pc}:${chord.quality}`]
  if (open) {
    return {
      frets: [...open.frets],
      fingers: [...open.fingers],
      barres: open.barres ? open.barres.map((b) => ({ ...b })) : [],
      position: 1,
    }
  }
  const forms = MOVABLE[chord.quality] ?? MOVABLE.maj
  let best: { form: MovableForm; position: number } | null = null
  for (const form of forms) {
    let rootFret = (chord.pc - ROOT_PC[form.rootString] + 12) % 12
    if (rootFret === 0) rootFret = 12
    let position = rootFret - form.rootOffset
    if (position < 1) position += 12
    if (!best || position < best.position) best = { form, position }
  }
  if (!best) return null
  const { form } = best
  let { position } = best
  // dim7 repeats every 3 frets (symmetric chord) — fold high voicings down.
  if (chord.quality === 'dim7') position = ((position - 1) % 3) + 1
  const { fingers, barres } = fingerForm(form, position)
  return {
    frets: form.offsets.map((o) => (o == null ? null : position + o)),
    fingers,
    barres,
    position,
  }
}

// ---- the beat grid ---------------------------------------------------------

export interface BeatGrid {
  bpm: number
  beatsPerBar: number
  /** Track time of beat 1, in seconds. */
  offset: number
  /** Seconds per beat. */
  spb: number
}

export const MIN_BPM = 20
export const MAX_BPM = 400

/** Build a grid from raw (possibly imported, possibly junk) settings values. */
export function makeGrid(
  bpm: number,
  beatsPerBar = 4,
  offset = 0,
): BeatGrid {
  const b = Math.min(Math.max(bpm, MIN_BPM), MAX_BPM)
  const bpb = Math.min(Math.max(Math.round(beatsPerBar) || 4, 1), 12)
  const off = Number.isFinite(offset) ? Math.max(0, offset) : 0
  return { bpm: b, beatsPerBar: bpb, offset: off, spb: 60 / b }
}

/** Track seconds → fractional beat index (beat 0 sounds at the offset). */
export const beatAt = (g: BeatGrid, t: number): number => (t - g.offset) / g.spb

/** Beat index → track seconds. */
export const timeOfBeat = (g: BeatGrid, beat: number): number =>
  g.offset + beat * g.spb

/** 1-based bar·beat readout for a time ("bar 12, beat 3"). Pre-roll → bar 1. */
export function barBeatOf(g: BeatGrid, t: number): { bar: number; beat: number } {
  const b = Math.floor(beatAt(g, t))
  if (b < 0) return { bar: 1, beat: 1 }
  return {
    bar: Math.floor(b / g.beatsPerBar) + 1,
    beat: (b % g.beatsPerBar) + 1,
  }
}

/** Median-interval tap tempo; null until two taps land. Timestamps in ms. */
export function tapBpm(taps: number[]): number | null {
  if (taps.length < 2) return null
  const gaps = taps
    .slice(-9)
    .map((t, i, a) => (i > 0 ? t - a[i - 1] : NaN))
    .filter((g) => Number.isFinite(g))
    .sort((a, b) => a - b)
  const mid = gaps[Math.floor(gaps.length / 2)]
  if (!mid || mid <= 0) return null
  return Math.min(Math.max(Math.round(60_000 / mid), MIN_BPM), MAX_BPM)
}

// ---- progressions → events -------------------------------------------------

/** Tokens that mean "no chord sounds here". */
const NO_CHORD = new Set(['nc', 'n.c.', 'n.c', '–', '—'])
/** Tokens that hold the previous chord for another slot. */
const HOLD = new Set(['.', '-', '_'])

/**
 * Parse chart text into bars of slots. Bars split on `|` (or newlines);
 * chords inside a bar divide it evenly; `.` extends the previous chord;
 * `%` (or an empty bar between pipes) repeats the previous bar; `N.C.` is a
 * rest (null slot). Text with no bar marks at all reads one chord per bar.
 */
export function parseProgression(text: string): (string | null)[][] {
  const src = text.replace(/[\r\n]+/g, '|').trim()
  if (!src) return []
  const rawBars = src.includes('|')
    ? src.split('|').map((s) => s.trim())
    : src.split(/\s+/).map((s) => s.trim())
  // Outer empties from leading/trailing pipes vanish; interior ones repeat.
  while (rawBars.length && rawBars[0] === '') rawBars.shift()
  while (rawBars.length && rawBars[rawBars.length - 1] === '') rawBars.pop()

  const bars: (string | null)[][] = []
  let carry: string | null = null
  for (const raw of rawBars) {
    if (raw === '' || raw === '%') {
      if (bars.length) bars.push([...bars[bars.length - 1]])
      continue
    }
    const bar: (string | null)[] = []
    for (const token of raw.split(/\s+/)) {
      const low = token.toLowerCase()
      if (HOLD.has(token)) bar.push(carry)
      else if (NO_CHORD.has(low)) {
        carry = null
        bar.push(null)
      } else {
        carry = token
        bar.push(token)
      }
    }
    if (bar.length) bars.push(bar)
  }
  return bars
}

export interface ChordEvent {
  /** The symbol as typed — what the lane label and diagram title show. */
  name: string
  chord: ParsedChord | null
  shape: ChordShape | null
  /** Span in beats (fractional when a bar divides unevenly) and seconds. */
  startBeat: number
  endBeat: number
  start: number
  end: number
  sectionId: string
}

/**
 * Lay every section's progression onto the grid as a sorted event list.
 * Section edges snap to the nearest beat; a progression shorter than its
 * section loops; one longer is clipped; consecutive repeats of the same
 * chord merge into one event (so a looped "| A | A |" reads as one span).
 */
export function buildChordEvents(
  sections: Annotation[],
  grid: BeatGrid,
): ChordEvent[] {
  const events: ChordEvent[] = []
  const parsed = new Map<string, { chord: ParsedChord | null; shape: ChordShape | null }>()
  const lookup = (name: string) => {
    let hit = parsed.get(name)
    if (!hit) {
      const chord = parseChord(name)
      hit = { chord, shape: shapeFor(chord) }
      parsed.set(name, hit)
    }
    return hit
  }

  for (const sec of sortedSections(sections)) {
    const text = sec.chords?.trim()
    const end = sec.end ?? sec.start
    if (!text || end <= sec.start) continue
    const bars = parseProgression(text)
    if (bars.length === 0) continue

    const b0 = Math.round(beatAt(grid, sec.start))
    const b1 = Math.round(beatAt(grid, end))
    if (b1 - b0 < 1) continue

    const B = grid.beatsPerBar
    const nBars = Math.ceil((b1 - b0) / B)
    for (let bi = 0; bi < nBars; bi++) {
      const bar = bars[bi % bars.length]
      const slotBeats = B / bar.length
      for (let si = 0; si < bar.length; si++) {
        const name = bar[si]
        const startBeat = b0 + bi * B + si * slotBeats
        if (startBeat >= b1 - 1e-6) break
        const endBeat = Math.min(startBeat + slotBeats, b1)
        if (!name) continue
        const last = events[events.length - 1]
        if (
          last &&
          last.sectionId === sec.id &&
          last.name === name &&
          Math.abs(last.endBeat - startBeat) < 1e-6
        ) {
          last.endBeat = endBeat
          last.end = timeOfBeat(grid, endBeat)
          continue
        }
        const { chord, shape } = lookup(name)
        events.push({
          name,
          chord,
          shape,
          startBeat,
          endBeat,
          start: timeOfBeat(grid, startBeat),
          end: timeOfBeat(grid, endBeat),
          sectionId: sec.id,
        })
      }
    }
  }
  return events.sort((a, b) => a.startBeat - b.startBeat)
}

/** Index of the event sounding at fractional beat `b`, or -1 (binary search). */
export function eventIndexAt(events: ChordEvent[], b: number): number {
  let lo = 0
  let hi = events.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].startBeat <= b) {
      hit = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return hit >= 0 && b < events[hit].endBeat ? hit : -1
}

/**
 * The chords the diagram rail shows from beat `b`: the sounding event (or the
 * next one, when the playhead sits in a gap) followed by upcoming *changes* —
 * consecutive repeats of a name collapse. Returns at most `n`.
 */
export function chordWindow(
  events: ChordEvent[],
  b: number,
  n: number,
): { event: ChordEvent; current: boolean }[] {
  if (events.length === 0 || n <= 0) return []
  const at = eventIndexAt(events, b)
  const out: { event: ChordEvent; current: boolean }[] = []
  let i: number
  if (at >= 0) {
    out.push({ event: events[at], current: true })
    i = at + 1
  } else {
    i = events.findIndex((e) => e.startBeat > b)
    if (i < 0) i = events.length
  }
  for (; i < events.length && out.length < n; i++) {
    const prev = out[out.length - 1]
    if (prev && events[i].name === prev.event.name) continue
    out.push({ event: events[i], current: false })
  }
  return out
}
