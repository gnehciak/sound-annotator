// The embed: one passage of a track as a square play/pause button another page
// can iframe (`?embed=<publicId>&start=&end=[&stem=…]`). It plays what the
// clip export cuts (api/projects/[id]/clip.ts), so who may hear it is exactly
// who may read the project — and an iframe on someone else's site carries no
// session cookie (SameSite=Lax), so in practice the track's link has to be on.

export interface EmbedSpec {
  id: string
  start: number
  end: number
  /** Stems to play instead of the full mix. Empty = the full mix. */
  stems: string[]
}

export function embedUrl(spec: EmbedSpec): string {
  const q = new URLSearchParams({
    embed: spec.id,
    start: spec.start.toFixed(1),
    end: spec.end.toFixed(1),
  })
  for (const s of spec.stems) q.append('stem', s)
  return `${window.location.origin}${window.location.pathname}?${q}`
}
