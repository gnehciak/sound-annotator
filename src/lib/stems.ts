// Resolving a track's stems for the mixer: its own (from the project payload,
// written by the admin-only detect run) or, for a YouTube track that has none,
// the stems a teacher's board of the same video already made — fetched from
// GET /api/projects/:id/stems, which does the same-video fallback server-side.
// That's what lets a student's own board reuse the teacher's stems with no new
// paid analysis. See api/projects/[id]/stems.ts.
import { useEffect, useState } from 'react'
import type { Project } from '../types'

/** Display order for whichever of the six Demucs stems the analysis saved. */
export const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']

/**
 * The stems to drive the mixer: the project's own if present, else (for a
 * video track) the shared per-video store's, fetched once per track. Returns
 * undefined while there are none to show.
 *
 * `savedTick` is App's count of finished saves. A track made a moment ago has
 * no row on the server until its first debounced save lands, so the lookup
 * answers 404; that one answer is retried after each save until the row is
 * there, which is what puts the mixer up on the first open rather than only
 * after a reload. A real answer (stems or none) is never re-asked.
 */
export function useResolvedStems(
  project: Project | null,
  savedTick = 0,
): Record<string, string> | undefined {
  const own = project?.stems
  const id = project?.id ?? null
  const src = project?.source
  // Only worth a lookup for a video track with no stems of its own.
  const recording =
    src?.type === 'youtube' ? src.videoId : src?.type === 'drive' ? src.driveFileId : undefined
  const canBorrow = !own && !!recording
  const [borrowed, setBorrowed] = useState<Record<string, string> | undefined>()
  // The row wasn't on the server yet; re-ask on the next save.
  const [unsaved, setUnsaved] = useState(false)
  const retry = unsaved ? savedTick : 0

  useEffect(() => {
    if (retry === 0) setBorrowed(undefined)
    setUnsaved(false)
    if (!id || !canBorrow) return
    let cancelled = false
    fetch(`/api/projects/${encodeURIComponent(id)}/stems`)
      .then((r) => {
        if (r.status === 404 && !cancelled) setUnsaved(true)
        return r.ok ? r.json() : null
      })
      .then((d: { stems?: Record<string, string> | null } | null) => {
        if (!cancelled && d?.stems && Object.keys(d.stems).length > 0) setBorrowed(d.stems)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // `recording` too: picking the video is what makes the lookup worth doing.
  }, [id, canBorrow, recording, retry])

  return own ?? borrowed
}
