// Song-structure projects: a "structure" track's annotations are its
// *sections* — plain Annotations carrying `structure: true`, a `sectionName`,
// a start–end range, and a colour. Reusing the annotation model means
// persistence, undo history, the edit lock, sharing, and copies all work
// unchanged; only the editor surface differs (see components/structure/).
import type { Annotation, Project } from '../types'

/** Whether a project opens as a song-structure board (vs the notes workspace). */
export function isStructureProject(p?: Project | null): boolean {
  return p?.settings?.kind === 'structure'
}

/**
 * The canonical pop-song section vocabulary, each with its identity hue.
 * Hues stay within the app's note data palette (colour-is-data): they encode
 * which *kind* of section, never mood. One click on a preset chip names and
 * colours a section in one move.
 */
export interface SectionPreset {
  name: string
  color: string
}

export const SECTION_PRESETS: SectionPreset[] = [
  { name: 'Intro', color: '#3bb6a6' }, // teal
  { name: 'Verse', color: '#5aa8e6' }, // sky
  { name: 'Pre-Chorus', color: '#f5a623' }, // amber
  { name: 'Chorus', color: '#ef6f8b' }, // rose
  { name: 'Post-Chorus', color: '#ef8b4b' }, // orange
  { name: 'Bridge', color: '#a07bf0' }, // violet
  { name: 'Solo', color: '#9ccb63' }, // green
  { name: 'Outro', color: '#d946ef' }, // magenta
]

/** Sections in timeline order (start, then end as the tiebreaker). */
export function sortedSections(anns: Annotation[]): Annotation[] {
  return [...anns].sort(
    (a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start),
  )
}

/** The section sounding at time `t` (start ≤ t < end), if any. */
export function sectionAt(anns: Annotation[], t: number): Annotation | undefined {
  return anns.find((a) => a.start <= t && t < (a.end ?? a.start))
}

/** A section's display name ("Section" when unnamed). */
export function sectionName(a: Annotation): string {
  return a.sectionName?.trim() || 'Section'
}

/**
 * The preset a name belongs to, ignoring case and a numbering suffix —
 * "Verse 2" matches the Verse preset (so its chip can light as active).
 */
export function presetFor(name: string): SectionPreset | undefined {
  const base = name.trim().replace(/\s+\d+$/, '').toLowerCase()
  return SECTION_PRESETS.find((p) => p.name.toLowerCase() === base)
}

/**
 * Numbered variant of a preset name that isn't taken yet: the first "Verse"
 * is just "Verse"; the next becomes "Verse 2", then "Verse 3", …
 */
export function dedupedName(base: string, existing: Annotation[]): string {
  const names = new Set(
    existing.map((a) => (a.sectionName ?? '').trim().toLowerCase()),
  )
  if (!names.has(base.toLowerCase())) return base
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`
    if (!names.has(candidate.toLowerCase())) return candidate
  }
}
