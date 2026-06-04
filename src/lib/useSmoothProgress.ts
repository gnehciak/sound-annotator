import { useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from './usePresence'

interface SmoothProgressOpts {
  /** Note start, in seconds. */
  start: number
  /** Note span in seconds (effective end − start); must be > 0. */
  span: number
  /** Whether the track is currently playing. */
  playing: boolean
  /** Current playback rate (1 = normal). */
  rate: number
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

// Reconciliation tuning (seconds, except FOLLOW which is a per-frame fraction).
// A discrepancy beyond SEEK_SNAP is treated as a real seek and snapped; smaller
// ones are coarse-poll jitter and are absorbed *without ever moving backward*.
const SEEK_SNAP = 0.7
// How far the optimistic clock may lead the player before it waits (rather than
// run away) — bounds drift without a backward jump.
const MAX_AHEAD = 0.3
// Per-frame easing toward the live position (forward catch-up, and the settle on
// pause). ~exponential; ≈80ms to converge at 60fps.
const FOLLOW = 0.18

/**
 * A note's playback progress (0..1), smoothed to the display's frame rate.
 *
 * The raw `currentTime` the players report ticks coarsely — the YouTube player
 * polls its position just 4×/s, and `getCurrentTime()` itself lags/quantizes —
 * so a bar bound straight to it visibly steps, and naive extrapolation snaps
 * backward whenever a poll lands behind the prediction. Instead we run a
 * **monotonic clock**: while the playhead is inside this note it advances forward
 * at the playback rate and re-syncs to the player's extrapolated position, but it
 * never steps backward for ordinary jitter — only a genuine seek (a large
 * discrepancy) snaps it. On pause it eases to the true position rather than
 * jumping. Only the note under the playhead runs a loop, so the cost is ~one rAF.
 */
export function useSmoothProgress(
  currentTime: number,
  { start, span, playing, rate }: SmoothProgressOpts,
): number {
  const within = currentTime >= start && currentTime < start + span
  const exact = clamp01((currentTime - start) / span)
  // The rAF clock owns the value whenever the playhead is inside the note (both
  // playing — to smooth — and paused — to settle the overshoot and follow a
  // scrub). Outside the note the bar is simply empty/full, so we use `exact`.
  const live = within && rate > 0 && !prefersReducedMotion()

  const [shown, setShown] = useState(exact)

  // Latest player sample: its reported time + the wall-clock when it landed.
  // Stamped only when currentTime actually changes, so a repeated (quantized)
  // poll value doesn't reset the extrapolation baseline.
  const sample = useRef({ time: currentTime, wall: 0 })
  useEffect(() => {
    sample.current = { time: currentTime, wall: performance.now() }
  }, [currentTime])

  // The smoothed absolute play time (seconds) we render. Mutated each frame and
  // preserved across play/pause, so neither transition snaps the bar.
  const displayed = useRef(currentTime)

  useEffect(() => {
    if (!live) return
    let raf = 0
    let last = performance.now()
    const loop = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const { time, wall } = sample.current
      let d = displayed.current
      if (playing) {
        // Where the player's last real sample projects to *now*.
        const proj = wall > 0 ? time + ((now - wall) / 1000) * rate : time
        d += dt * rate // optimistic forward step
        const ahead = d - proj
        if (Math.abs(ahead) > SEEK_SNAP) d = proj // genuine seek (either way) → snap
        else if (ahead > MAX_AHEAD) d -= dt * rate // ran too far ahead → hold, don't reverse
        else if (ahead < 0) d += -ahead * FOLLOW // behind → catch up (forward only)
      } else {
        // Paused: ease (or snap, for a scrub) to the true position — settles the
        // optimistic overshoot smoothly instead of jumping back.
        const diff = time - d
        d = Math.abs(diff) > SEEK_SNAP ? time : d + diff * FOLLOW
      }
      displayed.current = d
      const v = clamp01((d - start) / span)
      // Bail out of the re-render once converged (paused & parked) so an idle
      // loop costs nothing but the rAF callback itself.
      setShown((prev) => (Math.abs(prev - v) < 0.0004 ? prev : v))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [live, playing, rate, start, span])

  return live ? shown : exact
}
