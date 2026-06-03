// Each note renders with a colored spine + timecode tag. The color is derived
// from the note id so it stays stable no matter how the list is sorted.
const NOTE_COLORS = [
  '#f5a623', // amber
  '#3bb6a6', // teal
  '#a07bf0', // violet
  '#9ccb63', // green
  '#ef6f8b', // rose
  '#5aa8e6', // sky
  '#ef8b4b', // orange
]

export function colorForId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return NOTE_COLORS[h % NOTE_COLORS.length]
}

// A broad palette to pick a custom note colour from.
export const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f5a623', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#a8a29e', '#e9e4d8',
]
