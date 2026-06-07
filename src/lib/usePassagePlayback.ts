import { useCallback, useEffect, useRef, useState } from 'react'
import type { Annotation } from '../types'

/**
 * One-shot "play this passage" for range notes — the loop-glyph segment fused
 * to a note's timecode chip: seek to the note's start, play, and pause exactly
 * at its end. Clicking again while armed restarts the passage from the top.
 *
 * The armed stop lives as a position window, watched off the host's
 * `currentTime` ticks (no timers): crossing the end pauses and snaps the
 * playhead onto it; leaving the window (seeking/jumping away) silently
 * disarms. Pausing *inside* the passage keeps the stop armed, so resuming
 * still halts at the end.
 */
export function usePassagePlayback({
  currentTime,
  seek,
  play,
  pause,
}: {
  currentTime: number
  seek: (t: number) => void
  play: () => void
  pause: () => void
}): {
  /** Id of the note whose passage is armed to stop at its end (lights the chip). */
  passageId: string | null
  /** Play `a` from its start, pausing at its end. No-op for point notes. */
  playPassage: (a: Annotation) => void
  /** Drop an armed stop without touching playback (e.g. on track switch). */
  cancelPassage: () => void
}
{
  const [passageId, setPassageId] = useState<string | null>(null)
  // ticks counts *distinct* time values seen since arming: right after the
  // arming seek the player can still emit a few stale ticks from the old
  // position (the share viewer has no seek guard), so out-of-window checks
  // hold off for the first few.
  const armedRef = useRef<{ start: number; end: number; ticks: number; lastT: number } | null>(
    null,
  )

  const cancelPassage = useCallback(() => {
    armedRef.current = null
    setPassageId(null)
  }, [])

  const playPassage = useCallback(
    (a: Annotation) => {
      if (a.end == null) return
      armedRef.current = { start: a.start, end: a.end, ticks: 0, lastT: Number.NaN }
      setPassageId(a.id)
      seek(a.start)
      play()
    },
    [seek, play],
  )

  useEffect(() => {
    const a = armedRef.current
    if (!a) return
    if (currentTime !== a.lastT) {
      a.ticks += 1
      a.lastT = currentTime
    }
    const settling = a.ticks <= 4 // stale-tick grace right after the arming seek
    if (currentTime >= a.end) {
      if (settling) return
      cancelPassage()
      if (currentTime <= a.end + 2) {
        // Crossed the end naturally (ticks are coarse — ≤0.5s overshoot at 2×):
        // pause, and snap back so the playhead rests exactly on the end.
        pause()
        seek(a.end)
      }
      // Far past the end: the user jumped away — disarm without pausing.
      return
    }
    // Jumped back out the front of the passage — the user took over.
    if (currentTime < a.start - 1 && !settling) cancelPassage()
    // Watch the playhead only — transport callbacks are intentionally not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime])

  return { passageId, playPassage, cancelPassage }
}
