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

// The note/tag/element hues are tuned for a dark surface. As a FILL (spine,
// dot, timecode background) they read fine on either theme, but as TEXT or a
// 1px border on the warm note page their saturated mid-tones fail AA. Mix a
// hue toward ink for the light theme only; leave it untouched on dark.
function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

export function hueText(hex: string, theme: 'light' | 'dark'): string {
  if (theme !== 'light') return hex
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return hex
  // Mix toward ink (26 24 19); tuned so the lightest hues (amber, green) still
  // clear AA as text on the warm note page (#eae4d8).
  const k = 0.55
  return `rgb(${clamp255(r + (26 - r) * k)} ${clamp255(g + (24 - g) * k)} ${clamp255(b + (19 - b) * k)})`
}

// A broad palette to pick a custom note colour from.
export const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f5a623', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#a8a29e', '#e9e4d8',
]
