// Category tags a note can carry. Stored on Annotation.tags (an array; legacy
// notes carry a single Annotation.tag — read both via tagsOf). Each entry is a
// preset id ("pitch") or free custom text the user typed ("articulation").
export interface NoteTag {
  id: string
  label: string
  color: string
}

export const TAGS: NoteTag[] = [
  { id: 'pitch', label: 'Pitch', color: '#5aa8ff' },
  { id: 'rhythm', label: 'Rhythm', color: '#ff9f2e' },
  { id: 'duration', label: 'Duration', color: '#a06bff' },
  { id: 'dynamics', label: 'Dynamics', color: '#f472b6' },
  { id: 'harmony', label: 'Harmony', color: '#2dd4bf' },
  { id: 'form', label: 'Form', color: '#3ddc74' },
  { id: 'timbre', label: 'Timbre', color: '#ffd633' },
  { id: 'comment', label: 'Comment', color: '#9a9aa2' },
]

const BY_ID = new Map(TAGS.map((t) => [t.id, t]))
const PALETTE = TAGS.map((t) => t.color)

export function isPreset(tag: string): boolean {
  return BY_ID.has(tag)
}

/**
 * A note's tags, normalised across the model migration: the `tags` array is
 * authoritative once present (even when empty); otherwise fall back to the
 * legacy single `tag`. Every read site goes through this.
 */
export function tagsOf(note: { tag?: string; tags?: string[] }): string[] {
  if (note.tags) return note.tags
  return note.tag ? [note.tag] : []
}

type TaggedNote = { tag?: string; tags?: string[] }

/**
 * Distinct custom (non-preset) tags used across a project's notes, in
 * first-seen order. Lets the picker offer a project-scoped vocabulary for
 * reuse without any global list.
 */
export function customTagsUsedIn(notes: TaggedNote[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of notes) {
    for (const t of tagsOf(n)) {
      if (!isPreset(t) && !seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
    }
  }
  return out
}

/**
 * Every distinct tag actually used across a project's notes — presets first in
 * their canonical order, then custom tags in first-seen order. The notes filter
 * offers exactly this set, so it never lists a tag with nothing to show.
 */
export function tagsUsedIn(notes: TaggedNote[]): string[] {
  const used = new Set<string>()
  for (const n of notes) for (const t of tagsOf(n)) used.add(t)
  const presets = TAGS.filter((t) => used.has(t.id)).map((t) => t.id)
  return [...presets, ...customTagsUsedIn(notes)]
}

/** How many notes carry each tag, keyed by the stored tag (preset id or custom text). */
export function tagCountsIn(notes: TaggedNote[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const n of notes) for (const t of tagsOf(n)) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

/** Resolve a stored tag (preset id or custom text) to a display label + color. */
export function resolveTag(tag?: string): { label: string; color: string } | undefined {
  if (!tag) return undefined
  const preset = BY_ID.get(tag)
  if (preset) return { label: preset.label, color: preset.color }
  // custom: derive a stable color from the text
  let h = 0
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0
  return { label: tag, color: PALETTE[h % PALETTE.length] }
}
