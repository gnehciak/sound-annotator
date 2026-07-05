// Shared "Station Card" cover art, used by the library tiles (HomePage) and
// the public Browse gallery: the deterministic waveform mark for tracks
// without a thumbnail, and the cue line that draws every note as a tick at
// its real position in its own hue.
import { useMemo } from 'react'
import { colorForId, hueText } from '../lib/noteColors'
import type { ResolvedTheme } from '../lib/theme'

/**
 * Waveform mark for tracks without a thumbnail (audio files, no source yet,
 * or a dead YouTube thumb). Deterministic from the track id — the same hue
 * rotation the notes use, bars from a seeded LCG — so a track keeps its cover.
 */
export function WaveArt({ id, theme }: { id: string; theme: ResolvedTheme }) {
  const bars = useMemo(() => {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    const n = 26
    const W = 320
    const H = 180
    const bw = 4
    const gap = (W - 60 - n * bw) / (n - 1)
    const out: { x: number; y: number; w: number; h: number }[] = []
    // Seeded LCG, advanced inline per bar (no closure — keeps the memo pure).
    let s = (h || 1) >>> 0
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) % 2147483648
      const t = i / (n - 1)
      const env = Math.sin(t * Math.PI) ** 0.6
      const bh = 8 + (s / 2147483648) * 80 * (0.3 + 0.7 * env)
      out.push({ x: 30 + i * (bw + gap), y: H / 2 - bh / 2, w: bw, h: bh })
    }
    return out
  }, [id])
  // hueText keeps the bars crisp on the pale inset well in light mode.
  const hue = hueText(colorForId(id), theme)
  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className="absolute inset-0 h-full w-full"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={hue} />
      ))}
    </svg>
  )
}

/** The minimum a note must carry to be drawn on the cue line — satisfied by
 *  both full Annotations and the Browse payload's stripped ticks. */
export interface CueTick {
  id: string
  start: number
  end?: number
  color?: string
}

/**
 * The cue line: every note drawn as a tick at its position in the track, in
 * its own colour — the simplified annotation fingerprint. Positions normalise
 * against the last note (track duration isn't stored), which keeps relative
 * spacing honest. Notes with no siblings still read as "annotated".
 */
export function CueLine({
  notes,
  theme,
}: {
  notes: CueTick[]
  theme: ResolvedTheme
}) {
  const ticks = useMemo(() => {
    if (notes.length === 0) return []
    const last = Math.max(...notes.map((n) => n.end ?? n.start), 1)
    const scale = last * 1.04 // small right pad so the last tick isn't flush
    return notes.map((n) => ({
      x: 4 + (n.start / scale) * 989,
      color: hueText(n.color ?? colorForId(n.id), theme),
    }))
  }, [notes, theme])
  return (
    <svg
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      aria-hidden
      className="h-full w-full"
    >
      <rect
        x={0}
        y={46}
        width={1000}
        height={8}
        style={{ fill: 'rgb(var(--text) / 0.1)' }}
      />
      {ticks.map((t, i) => (
        <rect key={i} x={t.x} y={16} width={7} height={68} fill={t.color} />
      ))}
    </svg>
  )
}
