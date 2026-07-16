// Each note renders with a colored spine + timecode tag. The color is derived
// from the note id so it stays stable no matter how the list is sorted.
// Crayon-box data palette (2026-07-17 reskin): the canvas is neutral in both
// themes, so the note hues carry the playfulness. Palette-independent — hue
// encodes identity, and must not move when the signal palette changes.
const NOTE_COLORS = [
  '#ff5252', // red
  '#ff9f2e', // orange
  '#ffd633', // yellow
  '#3ddc74', // green
  '#2dd4bf', // teal
  '#5aa8ff', // sky
  '#f472b6', // pink
  '#a06bff', // violet
]

export function colorForId(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return NOTE_COLORS[h % NOTE_COLORS.length]
}

// The note/tag/element hues are tuned for a dark surface. As a FILL (spine,
// dot, timecode background) they read fine on either theme, but as TEXT or a
// 1px border on the white page their saturated mid-tones fail AA. Mix a
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
  // Mix toward ink (22 22 24); tuned so the lightest hues (yellow, green) still
  // clear AA as text on the white note page.
  const k = 0.55
  return `rgb(${clamp255(r + (22 - r) * k)} ${clamp255(g + (22 - g) * k)} ${clamp255(b + (24 - b) * k)})`
}

// A broad palette to pick a custom note colour from.
export const PRESET_COLORS = [
  '#ef4444', '#f97316', '#ff9f2e', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#a8a29e', '#ececf0',
]
