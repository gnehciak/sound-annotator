import { useState } from 'react'
import type { ProjectChords } from '../types'
import { chordAt, timeBeat } from './chords'
import { useSmoothClock } from './useSmoothClock'

/**
 * Which chord is sounding, read off the frame-rate clock rather than the
 * players' 250 ms ticks — so a chord lights the frame the playhead reaches
 * it, not up to a quarter-second later while the playhead (on the same
 * smooth clock) is visibly already on it. React state, but set only when
 * the answer changes, so it costs a render per chord boundary and nothing
 * per frame.
 */
export function useSoundingChord(
  chords: ProjectChords | undefined,
  currentTime: number,
  isPlaying: boolean,
  rate: number,
): string | null {
  const [id, setId] = useState<string | null>(null)
  useSmoothClock(currentTime, isPlaying, rate, (t) => {
    const next = chords ? (chordAt(chords.chords, timeBeat(chords, t))?.id ?? null) : null
    setId((prev) => (prev === next ? prev : next))
  })
  return id
}
