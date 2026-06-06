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

/** A note's full plain text (TipTap HTML stripped, whitespace collapsed). */
export function notePlainText(contentHtml: string): string {
  const doc = new DOMParser().parseFromString(contentHtml, 'text/html')
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** A short plain-text snippet of a note's TipTap HTML, for previews/labels. */
export function notePreview(contentHtml: string, max = 80): string {
  const text = notePlainText(contentHtml)
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

/** Epoch ms -> compact "ago" label for tiles ("just now", "5m ago", "2d ago"). */
export function formatRelativeTime(ts: number): string {
  if (!ts) return '—' // legacy docs default updatedAt to 0
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  if (w < 5) return `${w}w ago`
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
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
