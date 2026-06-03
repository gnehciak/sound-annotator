/** Seconds -> "m:ss" (or "h:mm:ss" past an hour). */
export function formatTime(seconds: number): string {
  let s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** A note's timecode label: a single moment, or a range. */
export function noteLabel(start: number, end?: number): string {
  return end != null
    ? `${formatTime(start)}–${formatTime(end)}`
    : formatTime(start)
}

/** Parse "m:ss" / "h:mm:ss" / plain seconds into seconds. null if invalid. */
export function parseTime(input: string): number | null {
  const s = input.trim()
  if (!s) return null
  const parts = s.split(':').map((p) => p.trim())
  if (parts.length > 3) return null
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null
  const n = parts.map(Number)
  if (n.length === 1) return n[0]
  if (n.length === 2) return n[0] * 60 + n[1]
  return n[0] * 3600 + n[1] * 60 + n[2]
}
