// The chord track of a song-structure board (settings.chords): a Hooktheory-
// style progression written in scale degrees over a beat grid.
//
// Two ideas, kept apart on purpose. The *grid* is tempo + downbeat + metre,
// which is what ties a beat to a second of the recording. The *chords* are
// positioned in beats on that grid, never in seconds — so retuning the tempo
// slides every chord to where the music actually is, and a chord is a scale
// degree (I, ii, V…) rather than a letter name, so changing the key re-spells
// the whole progression rather than invalidating it. Both are exactly what
// a teacher does when the first guess at the tempo or the key was wrong.
import type { Chord, ChordMode, ProjectChords } from '../types'
import { newId } from './ids'

// ---- keys and modes ------------------------------------------------------

/** Every tonic spelling the key menu offers, in fifths-agnostic chromatic
 *  order with both enharmonics where a real song uses either (F# and Gb
 *  major both exist; a "B# major" does not). */
export const KEY_NAMES = [
  'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab',
  'A', 'A#', 'Bb', 'B',
] as const

export const CHORD_MODES: { id: ChordMode; label: string }[] = [
  { id: 'major', label: 'Major' },
  { id: 'minor', label: 'Minor' },
  { id: 'dorian', label: 'Dorian' },
  { id: 'mixolydian', label: 'Mixolydian' },
  { id: 'lydian', label: 'Lydian' },
  { id: 'phrygian', label: 'Phrygian' },
  { id: 'locrian', label: 'Locrian' },
]

/** Semitone steps of each mode from its tonic. */
const MODE_STEPS: Record<ChordMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const ACCIDENTAL: Record<number, string> = {
  [-2]: '𝄫',
  [-1]: '♭',
  [0]: '',
  [1]: '♯',
  [2]: '𝄪',
}

/** Parse "Eb" / "F#" / "C" into a letter index and pitch class. Anything
 *  unreadable falls back to C, which is what a sanitized key already is. */
function parseKey(name: string): { letter: number; pc: number } {
  const m = /^([A-G])(#{0,2}|b{0,2})$/.exec(name)
  if (!m) return { letter: 0, pc: 0 }
  const letter = LETTERS.indexOf(m[1] as (typeof LETTERS)[number])
  const acc = m[2].startsWith('#') ? m[2].length : -m[2].length
  return { letter, pc: (LETTER_PC[m[1]] + acc + 12) % 12 }
}

/** A spelled note: its letter, and its accidental as a signed count. */
interface Spelled {
  letter: number
  acc: number
  pc: number
}

/**
 * The seven notes of a key, spelled by letter — each degree gets the next
 * letter, and the accidental is whatever makes the letter land on the mode's
 * pitch. That is what makes F♯ major come out as F♯ G♯ A♯ B C♯ D♯ E♯ rather
 * than a pile of flats, and it needs no table of key signatures.
 */
export function scaleOf(key: string, mode: ChordMode): Spelled[] {
  const tonic = parseKey(key)
  return MODE_STEPS[mode].map((step, i) => {
    const letter = (tonic.letter + i) % 7
    const pc = (tonic.pc + step) % 12
    // Signed distance from the plain letter to the pitch, folded into -6..5
    // so a letter never picks up five sharps for a note a flat away.
    let acc = (pc - LETTER_PC[LETTERS[letter]] + 12) % 12
    if (acc > 6) acc -= 12
    return { letter, acc, pc }
  })
}

const noteName = (n: Spelled) => `${LETTERS[n.letter]}${ACCIDENTAL[n.acc] ?? ''}`

export type Triad = 'maj' | 'min' | 'dim' | 'aug'

/** Everything the UI needs to draw one chord in one key. */
export interface ChordSpelling {
  /** Roman numeral with quality (ii, IV, vii°) and inversion figures. */
  roman: string
  /** Figured-bass superscript, shown after the numeral: 6, 64, 7, 65, 43, 42. */
  figure: string
  /** Letter name: Dm7, G7, Bm7♭5, C/E. */
  name: string
  triad: Triad
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/**
 * Spell one chord in the given key: its numeral, its letter name and its
 * quality, all derived by stacking thirds inside the scale rather than from
 * a table, so every mode and every spelling comes out right for free.
 */
export function spellChord(
  chord: Pick<Chord, 'degree' | 'seventh' | 'inversion' | 'quality'>,
  key: string,
  mode: ChordMode,
): ChordSpelling {
  const scale = scaleOf(key, mode)
  const d = chord.degree - 1
  const root = scale[d]
  // Each chord tone is spelled on its own letter (a third up is two letters
  // up), at whatever pitch the key gives it — or, for a forced quality, at
  // the pitch the forced triad needs: major or minor third, perfect fifth,
  // and a minor seventh (the dominant / m7 shapes chords are borrowed for).
  const steps = [0, 2, 4, ...(chord.seventh ? [6] : [])]
  const forced = chord.quality
  const forcedSemis = forced ? [0, forced === 'maj' ? 4 : 3, 7, 10] : null
  const tones: Spelled[] = steps.map((step, i) => {
    const diatonic = scale[(d + step) % 7]
    if (!forcedSemis) return diatonic
    const letter = diatonic.letter
    const pc = (root.pc + forcedSemis[i]) % 12
    let acc = (pc - LETTER_PC[LETTERS[letter]] + 12) % 12
    if (acc > 6) acc -= 12
    return { letter, acc, pc }
  })
  const semis = (n: Spelled) => (n.pc - root.pc + 12) % 12
  const third = semis(tones[1])
  const fifth = semis(tones[2])
  const triad: Triad =
    third === 4 && fifth === 8
      ? 'aug'
      : third === 3 && fifth === 6
        ? 'dim'
        : third === 3
          ? 'min'
          : 'maj'
  const seventh = chord.seventh ? semis(tones[3]) : null

  // Roman numeral: case is the quality; ° and + mark the two odd triads.
  let roman = ROMAN[d]
  if (triad === 'min' || triad === 'dim') roman = roman.toLowerCase()
  if (triad === 'dim') roman += seventh === 10 ? 'ø' : '°'
  if (triad === 'aug') roman += '+'
  // A major triad under a major seventh is the one case the figure alone
  // would misread as dominant, so it carries the M.
  if (seventh === 11 && triad === 'maj') roman += 'M'

  const inv = Math.min(chord.inversion ?? 0, chord.seventh ? 3 : 2)
  const figure = chord.seventh
    ? ['7', '65', '43', '42'][inv]
    : ['', '6', '64'][inv]

  // Letter name, the way a lead sheet writes it.
  let name = noteName(root)
  if (triad === 'min') name += 'm'
  else if (triad === 'dim') name += seventh === 10 ? 'm' : '°'
  else if (triad === 'aug') name += '+'
  if (seventh != null) {
    if (seventh === 11) name += 'maj7'
    else if (triad === 'dim' && seventh === 10) name += '7♭5'
    else if (triad === 'dim') name += '7'
    else name += '7'
  }
  if (inv > 0) name += `/${noteName(tones[inv])}`

  return { roman, figure, name, triad }
}

/**
 * The hue of each degree — colour-is-data, one per function, so a IV is the
 * same green in every key and a class can read a progression's shape at a
 * glance before it can read the numerals. Hooktheory's rainbow, drawn from
 * the app's own note palette.
 */
export const DEGREE_COLORS = [
  '#ef6f8b', // I — rose
  '#ef8b4b', // ii — orange
  '#f5a623', // iii — amber
  '#9ccb63', // IV — green
  '#5aa8e6', // V — sky
  '#a07bf0', // vi — violet
  '#d946ef', // vii — magenta
]

export const degreeColor = (degree: number) =>
  DEGREE_COLORS[Math.min(7, Math.max(1, degree)) - 1]

// ---- the beat grid -------------------------------------------------------

export const MIN_BPM = 30
export const MAX_BPM = 300
export const BEATS_PER_BAR_OPTIONS = [2, 3, 4, 5, 6, 7]

/** A fresh chord track: nothing written yet, a grid a teacher can retune. */
export function defaultChords(bpm?: number): ProjectChords {
  return {
    key: 'C',
    mode: 'major',
    bpm: bpm && bpm >= MIN_BPM && bpm <= MAX_BPM ? Math.round(bpm * 10) / 10 : 120,
    offset: 0,
    beatsPerBar: 4,
    chords: [],
  }
}

/** Seconds ↔ beats on the grid. Beat 0 is the downbeat at `offset`; beats
 *  before it are negative, which is allowed — a pickup bar is real music. */
export const beatTime = (g: Pick<ProjectChords, 'bpm' | 'offset'>, beat: number) =>
  g.offset + (beat * 60) / g.bpm
export const timeBeat = (g: Pick<ProjectChords, 'bpm' | 'offset'>, t: number) =>
  ((t - g.offset) * g.bpm) / 60

/** Shortest chord a gesture can produce, in beats. */
export const MIN_CHORD_BEATS = 0.5
const EPS = 1e-6

/** Quantise a beat to the grid the current zoom can show: half-beats when
 *  there is room to aim at them, whole beats otherwise, bars when the beats
 *  themselves are too close to tell apart. */
export function beatQuantum(pixelsPerBeat: number, beatsPerBar: number): number {
  if (pixelsPerBeat >= 40) return 0.5
  if (pixelsPerBeat >= 12) return 1
  return beatsPerBar
}

export const snapBeat = (beat: number, quantum: number) =>
  Math.round(beat / quantum) * quantum

export function sortedChords(chords: Chord[]): Chord[] {
  return [...chords].sort((a, b) => a.beat - b.beat)
}

/** The chord sounding at `beat` (start ≤ beat < end), if any. */
export function chordAt(chords: Chord[], beat: number): Chord | undefined {
  return chords.find((c) => c.beat - EPS <= beat && beat < c.beat + c.len - EPS)
}

/** The empty room around `beat`: [previous chord's end, next chord's start],
 *  ignoring `exceptId` (the chord being moved). Unbounded ends are ±Infinity. */
export function chordGap(
  chords: Chord[],
  beat: number,
  exceptId?: string,
): { lo: number; hi: number } {
  let lo = -Infinity
  let hi = Infinity
  for (const c of chords) {
    if (c.id === exceptId) continue
    const end = c.beat + c.len
    if (end <= beat + EPS) lo = Math.max(lo, end)
    if (c.beat >= beat - EPS) hi = Math.min(hi, c.beat)
  }
  return { lo, hi }
}

/**
 * Write a chord at `at`, the way typing works: a chord that *starts* there is
 * overwritten in place and keeps its length; otherwise anything sounding
 * across `at` is cut off there, and the new chord runs for `len` beats or
 * until the next chord begins, whichever is sooner. Returns the new list and
 * where the cursor lands (the end of what was written), so a run of digits
 * lays chords end to end.
 */
export function writeChord(
  chords: Chord[],
  at: number,
  len: number,
  degree: number,
  seventh: boolean,
): { chords: Chord[]; cursor: number; id: string } {
  const exact = chords.find((c) => Math.abs(c.beat - at) < EPS)
  if (exact) {
    return {
      chords: chords.map((c) =>
        c.id === exact.id
          ? { ...c, degree, seventh: seventh || undefined, inversion: undefined }
          : c,
      ),
      cursor: exact.beat + exact.len,
      id: exact.id,
    }
  }
  const { hi } = chordGap(chords, at)
  const newLen = Math.max(MIN_CHORD_BEATS, Math.min(len, hi - at))
  const id = newId()
  const kept: Chord[] = []
  for (const c of chords) {
    if (c.beat < at && c.beat + c.len > at + EPS) {
      // Sounding across the insertion point: cut it there, or drop what is
      // left if the stub would be shorter than any chord can be.
      const cut = at - c.beat
      if (cut >= MIN_CHORD_BEATS - EPS) kept.push({ ...c, len: cut })
    } else kept.push(c)
  }
  kept.push({ id, beat: at, len: newLen, degree, ...(seventh ? { seventh } : {}) })
  return { chords: sortedChords(kept), cursor: at + newLen, id }
}

/**
 * What Backspace at `beat` deletes, the way a text editor's does: the chord
 * sounding across or ending at the point, or failing that the last chord
 * before it — a gap between the cursor and the previous chord is no more a
 * reason to refuse than a run of spaces is.
 */
export function chordBefore(chords: Chord[], beat: number): Chord | undefined {
  let best: Chord | undefined
  for (const c of chords) {
    if (c.beat >= beat - EPS) continue
    if (!best || c.beat + c.len > best.beat + best.len) best = c
  }
  return best
}

/** What forward Delete at `beat` removes: the chord sounding there, or the
 *  next one after it. */
export function chordAfter(chords: Chord[], beat: number): Chord | undefined {
  return (
    chordAt(chords, beat) ??
    sortedChords(chords).find((c) => c.beat >= beat - EPS)
  )
}

/** The triad the key gives a degree, before any forced quality. */
export function diatonicTriad(degree: number, key: string, mode: ChordMode): Triad {
  return spellChord({ degree }, key, mode).triad
}

/**
 * Flip a chord between major and minor. The override is stored only when it
 * differs from what the key gives, so a chord flipped back is diatonic again
 * (and re-spells with the key, as a diatonic chord should).
 */
export function toggleQuality(chord: Chord, key: string, mode: ChordMode): Chord {
  const now = spellChord(chord, key, mode).triad
  const want: 'maj' | 'min' = now === 'maj' ? 'min' : 'maj'
  return withQuality(chord, want, key, mode)
}

export function withQuality(
  chord: Chord,
  want: 'maj' | 'min',
  key: string,
  mode: ChordMode,
): Chord {
  const natural = diatonicTriad(chord.degree, key, mode)
  const next = { ...chord }
  if (natural === want) delete next.quality
  else next.quality = want
  return next
}

/** One bar line or beat line of the grid, in pixels from the window's left. */
export interface GridLine {
  x: number
  /** 1-based bar number, on bar lines only. */
  bar?: number
}

/**
 * The beat grid across a window of the timeline: bar lines (numbered) and
 * the beats between them, thinned as the zoom pulls out so the lines never
 * become a grey wash. Shared by the two lanes so their bars line up.
 */
export function beatGrid(
  g: Pick<ProjectChords, 'bpm' | 'offset' | 'beatsPerBar'>,
  vs: number,
  ve: number,
  xOf: (t: number) => number,
  pixelsPerBeat: number,
): { bars: GridLine[]; beats: GridLine[] } {
  const bars: GridLine[] = []
  const beats: GridLine[] = []
  if (ve <= vs || pixelsPerBeat <= 0) return { bars, beats }
  const { beatsPerBar } = g
  const b0 = Math.ceil(timeBeat(g, vs))
  const b1 = Math.floor(timeBeat(g, ve))
  const barPx = pixelsPerBeat * beatsPerBar
  const barStep = barPx >= 24 ? 1 : barPx >= 6 ? 4 : 16
  for (let b = b0; b <= b1; b++) {
    const x = xOf(beatTime(g, b))
    if (b % beatsPerBar === 0) {
      const bar = Math.floor(b / beatsPerBar)
      if (bar % barStep === 0) bars.push({ x, bar: bar + 1 })
    } else if (pixelsPerBeat >= 7) beats.push({ x })
  }
  return { bars, beats }
}

/** Slide the grid's downbeat when the clip window moves (App's setClip),
 *  so every chord stays on the music it was written over. */
export function shiftChords(
  chords: ProjectChords | undefined,
  delta: number,
): ProjectChords | undefined {
  if (!chords || delta === 0) return chords
  return { ...chords, offset: Math.round((chords.offset + delta) * 1000) / 1000 }
}

// ---- tap tempo -----------------------------------------------------------

/** Taps older than this start a new count: a pause is a new attempt. */
export const TAP_RESET_MS = 2500
const TAP_WINDOW = 8

/**
 * Fold a new tap into the running list and read the tempo off it: the mean
 * interval of the last few taps, which steadies after four or five presses.
 * Returns the taps to keep and the bpm they imply (null until there are two).
 */
export function tapTempo(
  taps: number[],
  now: number,
): { taps: number[]; bpm: number | null } {
  const fresh =
    taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS ? [] : taps
  const next = [...fresh, now].slice(-TAP_WINDOW)
  if (next.length < 2) return { taps: next, bpm: null }
  const span = next[next.length - 1] - next[0]
  const bpm = (60000 * (next.length - 1)) / span
  return { taps: next, bpm: Math.round(bpm * 10) / 10 }
}

/** Beats in a bar, formatted for the footer: "4 beats", "1 bar", "1½ bars". */
export function describeLength(beats: number, beatsPerBar: number): string {
  const bars = beats / beatsPerBar
  if (Number.isInteger(bars)) return `${bars} ${bars === 1 ? 'bar' : 'bars'}`
  const shown = Number.isInteger(beats) ? String(beats) : beats.toFixed(1)
  return `${shown} ${beats === 1 ? 'beat' : 'beats'}`
}
