// Category tags a note can carry. Stored on Annotation.tag, either as a preset
// id ("pitch") or as free custom text the user typed ("articulation").
export interface NoteTag {
  id: string
  label: string
  color: string
}

export const TAGS: NoteTag[] = [
  { id: 'pitch', label: 'Pitch', color: '#5aa8e6' },
  { id: 'rhythm', label: 'Rhythm', color: '#ef8b4b' },
  { id: 'duration', label: 'Duration', color: '#a07bf0' },
  { id: 'dynamics', label: 'Dynamics', color: '#ef6f8b' },
  { id: 'harmony', label: 'Harmony', color: '#3bb6a6' },
  { id: 'form', label: 'Form', color: '#9ccb63' },
  { id: 'timbre', label: 'Timbre', color: '#f5a623' },
  { id: 'comment', label: 'Comment', color: '#968d7c' },
]

const BY_ID = new Map(TAGS.map((t) => [t.id, t]))
const PALETTE = TAGS.map((t) => t.color)

export function isPreset(tag: string): boolean {
  return BY_ID.has(tag)
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
