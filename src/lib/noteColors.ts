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
// 1px border on the white page their saturated mid-tones fail AA.
function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}

/**
 * The hue a data colour wears as TEXT on the light page. It used to be a flat
 * 55% mix toward ink, which cleared AA but spent far more darkness than the
 * contrast needed and dragged every hue toward the same muddy brown — the
 * chips read as dried blood and olive rather than as colour (2026-09-08).
 *
 * So: lift the saturation first (the white page washes chroma out, the way the
 * black canvas eats it in the other direction), then darken *only as far as
 * 4.5:1 demands* and stop — the same "walk until it clears, then leave it
 * alone" shape as `hueOnDark`, run the other way. Yellow still ends up much
 * darker than sky blue, because it has to; nothing ends up darker than it has
 * to. Contrast is measured against the hue's own 14% wash over white (the
 * `.chip` / `.prop-tag` ground), so the value is safe on the tinted chip and
 * has margin to spare on plain paper.
 */
export function hueText(hex: string, theme: 'light' | 'dark'): string {
  if (theme !== 'light') return hex
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const [h, s0, l0] = rgbToHsl(rgb)
  // The ground the text actually sits on: the chip's own wash, not bare white.
  const bg = luminance(...mix(rgb, [255, 255, 255], 0.14))
  // Grey stays grey; a hue that has chroma gets more of it.
  const s = s0 < 0.08 ? s0 : Math.min(1, s0 * 1.08 + 0.1)
  let l = l0
  let out = hslToRgb(h, s, l)
  for (let i = 0; i < 100 && contrast(luminance(...out), bg) < 4.5; i++) {
    l = Math.max(0, l - 0.01)
    out = hslToRgb(h, s, l)
  }
  return `rgb(${out[0]} ${out[1]} ${out[2]})`
}

/** `a` mixed into `b` at `k` — sRGB, like CSS color-mix's default-ish path. */
function mix(
  a: [number, number, number],
  b: [number, number, number],
  k: number
): [number, number, number] {
  return [
    clamp255(b[0] + (a[0] - b[0]) * k),
    clamp255(b[1] + (a[1] - b[1]) * k),
    clamp255(b[2] + (a[2] - b[2]) * k),
  ]
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clamp255(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number) => {
    let x = t
    if (x < 0) x += 1
    if (x > 1) x -= 1
    if (x < 1 / 6) return p + (q - p) * 6 * x
    if (x < 1 / 2) return q
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6
    return p
  }
  return [
    clamp255(channel(h + 1 / 3) * 255),
    clamp255(channel(h) * 255),
    clamp255(channel(h - 1 / 3) * 255),
  ]
}

/**
 * The mirror of `hueText`, for chrome that is dark whatever the theme: the
 * over-video layer, whose card sits on the picture and so can never take the
 * light page's surfaces (see DESIGN.md, The Stage Layer). The eight data hues
 * clear AA on black on their own, but a custom colour picked from
 * PRESET_COLORS need not — several of the blues and violets land near 3.5:1 —
 * so lift the hue toward white until it does, and leave the rest alone.
 */
export function hueOnDark(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  // The card's own fill, which the text actually sits on.
  const bg = 0.02 // relative luminance of near-black under 76% black glass
  let [r, g, b] = rgb
  for (let i = 0; i < 12 && contrast(luminance(r, g, b), bg) < 4.5; i++) {
    r = clamp255(r + (255 - r) * 0.12)
    g = clamp255(g + (255 - g) * 0.12)
    b = clamp255(b + (255 - b) * 0.12)
  }
  return `rgb(${r} ${g} ${b})`
}

function parseHex(hex: string): [number, number, number] | null {
  const h = hex.replace('#', '')
  if (h.length !== 6) return null
  const v: [number, number, number] = [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
  return v.some(Number.isNaN) ? null : v
}

/** WCAG relative luminance, 0–1. */
function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

// A broad palette to pick a custom note colour from.
export const PRESET_COLORS = [
  '#ef4444', '#f97316', '#ff9f2e', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#a8a29e', '#ececf0',
]
