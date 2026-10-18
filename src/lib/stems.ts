// Resolving a track's stems for the mixer: its own (from the project payload,
// written by the admin-only detect run) or, for a YouTube track that has none,
// the stems a teacher's board of the same video already made — fetched from
// GET /api/projects/:id/stems, which does the same-video fallback server-side.
// That's what lets a student's own board reuse the teacher's stems with no new
// paid analysis. See api/projects/[id]/stems.ts.
import { useEffect, useState } from 'react'
import type { Project } from '../types'

/**
 * The stems to drive the mixer with: the project's own if present, else (for a
 * YouTube track) another same-video project's, fetched once per track. Returns
 * undefined while there are none to show.
 */
export function useResolvedStems(project: Project | null): Record<string, string> | undefined {
  const own = project?.stems
  const id = project?.id ?? null
  // Only worth a lookup for a YouTube track with no stems of its own.
  const canBorrow = !own && project?.source?.type === 'youtube' && !!project.source.videoId
  const [borrowed, setBorrowed] = useState<Record<string, string> | undefined>()

  useEffect(() => {
    setBorrowed(undefined)
    if (!id || !canBorrow) return
    let cancelled = false
    fetch(`/api/projects/${encodeURIComponent(id)}/stems`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { stems?: Record<string, string> | null } | null) => {
        if (!cancelled && d?.stems && Object.keys(d.stems).length > 0) setBorrowed(d.stems)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id, canBorrow])

  return own ?? borrowed
}
