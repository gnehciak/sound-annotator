// The clip export: a slice of the track's audio as an m4a file, cut on the
// server (api/projects/[id]/clip.ts) so only the seconds asked for travel.
import { ApiError, currentGuestKey } from './api'
import { formatTime } from './format'

/** Mirrors the server's cap — checked here too so the field can say so. */
export const MAX_CLIP_SECONDS = 600

export interface ClipRange {
  start: number
  end: number
}

export function clipRangeError(r: ClipRange, duration?: number): string | null {
  if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) return 'Times should look like 1:30 (or 90).'
  if (r.start < 0) return 'The start can’t be before the beginning.'
  if (r.end <= r.start) return 'The end has to come after the start.'
  if (duration && r.start >= duration) return 'The start is past the end of the track.'
  if (r.end - r.start > MAX_CLIP_SECONDS)
    return `A clip can be at most ${MAX_CLIP_SECONDS / 60} minutes long.`
  return null
}

/**
 * Fetch the clip and hand it to the browser as a download. Throws ApiError
 * with the server's message on failure, so the caller can show it.
 */
export async function downloadClip(
  project: { id: string; title: string },
  range: ClipRange,
): Promise<void> {
  const headers = new Headers()
  const key = currentGuestKey()
  if (key) headers.set('X-Guest-Key', key)
  const q = new URLSearchParams({
    start: range.start.toFixed(3),
    end: range.end.toFixed(3),
  })
  const res = await fetch(
    `/api/projects/${encodeURIComponent(project.id)}/clip?${q}`,
    { headers },
  )
  if (!res.ok) {
    const message = await res
      .json()
      .then((d: { error?: string }) => d.error ?? res.statusText)
      .catch(() => res.statusText)
    throw new ApiError(res.status, message)
  }
  const blob = await res.blob()
  const name = `${project.title || 'clip'} ${formatTime(range.start)}-${formatTime(range.end)}.m4a`
    .replace(/[\\/:*?"<>|]+/g, '.')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke after the click has had its tick — revoking synchronously cancels
  // the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Thirty seconds from the playhead, held inside the track. */
export function seedRange(currentTime: number, duration: number): ClipRange {
  const start = Math.max(0, Math.floor(currentTime))
  const wanted = start + 30
  const end = duration > 0 ? Math.min(Math.floor(duration), wanted) : wanted
  return end > start ? { start, end } : { start: Math.max(0, end - 30), end }
}
