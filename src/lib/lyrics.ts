// Timed lyrics: the track's words as a list of lines, each stamped with the
// clip second it starts sounding (see LyricLine in ../types). The list lives
// at `settings.lyrics`, in *document order* — the order the song sings them —
// and the timing rides on each line rather than reordering the list, so a
// stamp typed wrong never shuffles the verse it belongs to.
//
// Two orders matter, and every reader here is explicit about which one it
// wants. Document order is what the timer walks and what the text editor
// shows. Time order (`timedLines`) is what the video overlay and the lyric
// sheet read, and only timed lines have a place in it.
import type { Annotation, LyricLine, Project } from '../types'
import { sectionAt, sortedSections } from './sections'

/** Seconds a stamp lands *before* the press — you react after the moment. */
export const DEFAULT_LYRIC_LEAD = 0.3
/** Caps on what a file (or a paste) may hand us: this rides the jsonb. */
export const MAX_LYRIC_LINES = 2000
export const MAX_LYRIC_CHARS = 400

/**
 * The overlay's type sizes: multipliers on its frame-relative size, the stops
 * the A−/A+ keys walk. Wide enough at the top for a projector at the back of
 * a classroom, and low enough at the bottom to keep a long line on one row.
 */
export const LYRIC_SCALES = [0.6, 0.8, 1, 1.25, 1.5, 1.8, 2.2, 2.6]

export function clampLyricScale(v: number | undefined | null): number {
  if (v == null || !Number.isFinite(v)) return 1
  return Math.min(LYRIC_SCALES[LYRIC_SCALES.length - 1], Math.max(LYRIC_SCALES[0], v))
}

/** The stop one up (`dir` 1) or one down from `scale` — from its nearest stop,
 *  so a value a file hands us that sits between two still steps cleanly. */
export function stepLyricScale(scale: number, dir: 1 | -1): number {
  const cur = clampLyricScale(scale)
  let nearest = 0
  for (let k = 1; k < LYRIC_SCALES.length; k++)
    if (Math.abs(LYRIC_SCALES[k] - cur) < Math.abs(LYRIC_SCALES[nearest] - cur)) nearest = k
  return LYRIC_SCALES[Math.min(LYRIC_SCALES.length - 1, Math.max(0, nearest + dir))]
}

/**
 * The looks the overlay can take. `caption` is the quiet line at the foot;
 * the other three are the *lyric video* looks, mid-frame and animated — a
 * word at a time, a letter at a time, or filled left to right as the line is
 * sung. All CSS: the words are split into spans and each span carries its
 * index, and the stylesheet does the rest (see `.lyric-stage--*`).
 */
export const LYRIC_STYLES = [
  { id: 'caption', label: 'Caption', detail: 'A quiet line at the foot of the picture.' },
  { id: 'pop', label: 'Lyric video', detail: 'Brush capitals mid-frame, a word at a time.' },
  { id: 'rise', label: 'Rise', detail: 'Each letter climbs into place.' },
  { id: 'karaoke', label: 'Karaoke', detail: 'The line fills as it is sung.' },
] as const
export type LyricStyle = (typeof LYRIC_STYLES)[number]['id']

export function lyricStyleOf(v: string | undefined | null): LyricStyle {
  return LYRIC_STYLES.some((s) => s.id === v) ? (v as LyricStyle) : 'caption'
}

/** Tenths are the resolution the stamps are shown at, so it is what they keep. */
const tenths = (t: number) => Math.round(Math.max(0, t) * 10) / 10

/**
 * Pasted text → lines. One line per lyric line, trimmed; a blank line is a
 * *rest* — the screen clears there — but a run of blanks is one rest, and
 * blanks at either end are nothing at all.
 */
export function parseLyricText(text: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      if (out.length > 0 && out[out.length - 1].text !== '') out.push({ text: '' })
      continue
    }
    out.push({ text: line.slice(0, MAX_LYRIC_CHARS) })
  }
  while (out.length > 0 && out[out.length - 1].text === '') out.pop()
  return out.slice(0, MAX_LYRIC_LINES)
}

/** The lines as text again — what the paste box opens with. */
export function lyricsText(lines: LyricLine[]): string {
  return lines.map((l) => l.text).join('\n')
}

/**
 * Replace the words with a re-edited paste, keeping the timing of every line
 * that survived. Two passes, both in order. Lines whose words are unchanged
 * are matched exactly (each old line claimed at most once, never out of
 * sequence). Then every gap between two such anchors is compared: when the
 * gap holds the same number of unmatched lines on both sides, they are paired
 * by position — that is a line edited in place, and a typo fixed on line 12
 * keeps its stamp. A gap that grew is an insertion and its new lines arrive
 * untimed; one that shrank is a deletion and its stamps go with it.
 */
export function retextLyrics(lines: LyricLine[], text: string): LyricLine[] {
  const next = parseLyricText(text)
  // pairs[newIndex] = oldIndex, for the exact matches.
  const pairs = new Map<number, number>()
  let from = 0
  next.forEach((l, i) => {
    for (let k = from; k < lines.length; k++) {
      if (lines[k].text === l.text) {
        pairs.set(i, k)
        from = k + 1
        return
      }
    }
  })
  // Walk the gaps between anchors (with virtual anchors at both ends).
  const anchors = [[-1, -1], ...[...pairs].sort((a, b) => a[0] - b[0]), [next.length, lines.length]]
  for (let a = 0; a + 1 < anchors.length; a++) {
    const [n0, o0] = anchors[a]
    const [n1, o1] = anchors[a + 1]
    const newGap = n1 - n0 - 1
    const oldGap = o1 - o0 - 1
    if (newGap > 0 && newGap === oldGap)
      for (let j = 1; j <= newGap; j++) pairs.set(n0 + j, o0 + j)
  }
  return next.map((l, i) => {
    const old = pairs.has(i) ? lines[pairs.get(i)!] : undefined
    return old?.t != null ? { ...l, t: old.t } : l
  })
}

/** A timed line, with its place in the document. */
export interface TimedLine {
  index: number
  t: number
  text: string
}

/** Timed lines in time order (document order breaks ties). */
export function timedLines(lines: LyricLine[]): TimedLine[] {
  const out: TimedLine[] = []
  lines.forEach((l, index) => {
    if (l.t != null) out.push({ index, t: l.t, text: l.text })
  })
  return out.sort((a, b) => a.t - b.t || a.index - b.index)
}

/** Position in `timed` of the line sounding at `now` — the last one at or
 *  before it — or -1 before the first. Binary search: this runs per tick. */
export function timedIndexAt(timed: TimedLine[], now: number): number {
  let lo = 0
  let hi = timed.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (timed[mid].t <= now) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/**
 * What the video shows at `now`: the line sounding (null during a rest, and
 * before the first line) and the one coming after it.
 */
export function lyricAt(
  timed: TimedLine[],
  now: number,
): { current: TimedLine | null; next: TimedLine | null } {
  const i = timedIndexAt(timed, now)
  if (i < 0) return { current: null, next: null }
  const current = timed[i].text ? timed[i] : null
  const after = timed[i + 1]
  return { current, next: after && after.text ? after : null }
}

/** The first line still waiting for a stamp — where a timing pass resumes. */
export function firstUntimed(lines: LyricLine[]): number {
  const i = lines.findIndex((l) => l.t == null)
  return i === -1 ? lines.length : i
}

// ---- edits ----------------------------------------------------------------

export function stampLine(lines: LyricLine[], index: number, t: number): LyricLine[] {
  return lines.map((l, i) => (i === index ? { ...l, t: tenths(t) } : l))
}

export function clearLineTime(lines: LyricLine[], index: number): LyricLine[] {
  return lines.map((l, i) => {
    if (i !== index) return l
    const rest: LyricLine = { ...l }
    delete rest.t
    return rest
  })
}

export function nudgeLine(lines: LyricLine[], index: number, by: number): LyricLine[] {
  const t = lines[index]?.t
  return t == null ? lines : stampLine(lines, index, t + by)
}

export function setLineText(lines: LyricLine[], index: number, text: string): LyricLine[] {
  return lines.map((l, i) =>
    i === index ? { ...l, text: text.slice(0, MAX_LYRIC_CHARS) } : l,
  )
}

export function insertLineAfter(lines: LyricLine[], index: number): LyricLine[] {
  if (lines.length >= MAX_LYRIC_LINES) return lines
  const next = [...lines]
  next.splice(index + 1, 0, { text: '' })
  return next
}

export function removeLine(lines: LyricLine[], index: number): LyricLine[] {
  return lines.filter((_, i) => i !== index)
}

/** Forget every stamp and keep every word — a pass to be run again. */
export function clearAllTimes(lines: LyricLine[]): LyricLine[] {
  return lines.map(({ text }) => ({ text }))
}

/**
 * Re-anchor the stamps to a moved clip window, exactly as App's setClip does
 * to note times and lib/score.ts does to the page turns: `slide` is that same
 * mapping. Untimed lines have nothing to move.
 */
export function shiftLyrics(
  lines: LyricLine[] | undefined,
  slide: (t: number) => number,
): LyricLine[] | undefined {
  if (!lines || lines.length === 0) return lines
  return lines.map((l) => (l.t == null ? l : { ...l, t: tenths(slide(l.t)) }))
}

// ---- the sheet ------------------------------------------------------------

/** The lines that fall inside one section — or, with `section` null, a run
 *  of timed lines that fall inside none. */
export interface LyricGroup {
  section: Annotation | null
  lines: TimedLine[]
}

/**
 * The lyric sheet's shape: every section in timeline order, each carrying the
 * timed lines that start inside it (`start ≤ t < end`), with the lines that
 * start between sections slotted in where they fall. Every section is
 * listed, lyrics or not — a section with none is still a fact worth reading
 * off the sheet ("Solo — no lyrics") — and no line is listed twice: where
 * sections overlap, the earlier one keeps the line, as `sectionAt` decides.
 */
export function groupBySection(
  lines: LyricLine[],
  sections: Annotation[],
): { groups: LyricGroup[]; untimed: { index: number; text: string }[] } {
  const ordered = sortedSections(sections)
  const timed = timedLines(lines)
  const owner = new Map<number, string | null>()
  for (const l of timed) owner.set(l.index, sectionAt(ordered, l.t)?.id ?? null)

  const groups: LyricGroup[] = []
  let cursor = 0
  /** Emit the orphan lines before `until` as one heading-less group. */
  const flushOrphans = (until: number) => {
    const run: TimedLine[] = []
    while (cursor < timed.length && timed[cursor].t < until) {
      if (owner.get(timed[cursor].index) === null) run.push(timed[cursor])
      cursor++
    }
    if (run.length > 0) groups.push({ section: null, lines: run })
  }
  for (const sec of ordered) {
    flushOrphans(sec.start)
    groups.push({
      section: sec,
      lines: timed.filter((l) => owner.get(l.index) === sec.id),
    })
  }
  flushOrphans(Infinity)

  const untimed: { index: number; text: string }[] = []
  lines.forEach((l, index) => {
    if (l.t == null) untimed.push({ index, text: l.text })
  })
  return { groups, untimed }
}

// ---- migration ------------------------------------------------------------

/**
 * Fold the legacy per-section lyric blocks (`Annotation.lyrics`) into timed
 * lines. Each block's lines are spread evenly across its section — the one
 * thing the old shape did say was which section the words belonged to, and an
 * even spread keeps exactly that (every line lands inside its section) while
 * giving the video something to show until a timing pass replaces it.
 *
 * Read-side only, like `withMigratedOverlay`: a row keeps its old shape until
 * something writes it back. Runs only while `settings.lyrics` is absent — an
 * empty list is a deletion, and must not resurrect the blocks it deleted.
 * Returns the project untouched (not a copy) when there is nothing to fold.
 */
export function withMigratedLyrics(p: Project): Project {
  if (p.settings?.lyrics !== undefined) return p
  const carrying = p.annotations.filter((a) => a.lyrics?.trim())
  if (carrying.length === 0) return p
  const lines: LyricLine[] = []
  for (const sec of sortedSections(carrying)) {
    const words = parseLyricText(sec.lyrics ?? '')
    const span = Math.max(0, (sec.end ?? sec.start) - sec.start)
    words.forEach((w, i) =>
      lines.push({ ...w, t: tenths(sec.start + (span * i) / words.length) }),
    )
  }
  return {
    ...p,
    annotations: p.annotations.map((a) => {
      if (a.lyrics == null) return a
      const rest: Annotation = { ...a }
      delete rest.lyrics
      return rest
    }),
    settings: { ...p.settings, lyrics: lines.slice(0, MAX_LYRIC_LINES) },
  }
}
