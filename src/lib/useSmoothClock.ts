import { useEffect, useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from './usePresence'

// A frame-rate clock over the players' coarse `currentTime`, for anything
// that *moves* with the music — the board's playhead, the chord bar on the
// video. The YouTube player reports its position four times a second, so a
// mark bound straight to it steps; this runs the same monotonic clock
// `useSmoothProgress` does (forward at the playback rate, re-synced to each
// sample, never stepping back for jitter, snapping only for a real seek) but
// hands the value to a callback instead of React state, so a moving element
// costs one `style` write per frame and no re-render of anything.

const SEEK_SNAP = 0.7
const MAX_AHEAD = 0.3
const FOLLOW = 0.18

/**
 * Calls `onFrame(seconds)` every animation frame with the smoothed play time
 * while playing, and for the few frames it takes to settle after a pause or a
 * scrub. When motion is reduced, or nothing is moving, it is called once per
 * sample with the raw time instead. `onFrame` is read through a ref, so pass
 * a fresh closure freely.
 */
export function useSmoothClock(
  currentTime: number,
  playing: boolean,
  rate: number,
  onFrame: (seconds: number) => void,
): void {
  const cb = useRef(onFrame)
  useLayoutEffect(() => {
    cb.current = onFrame
  })
  const sample = useRef({ time: currentTime, wall: 0 })
  const displayed = useRef(currentTime)
  useEffect(() => {
    sample.current = { time: currentTime, wall: performance.now() }
  }, [currentTime])

  useEffect(() => {
    if (prefersReducedMotion() || rate <= 0) {
      displayed.current = currentTime
      cb.current(currentTime)
      return
    }
    let raf = 0
    let last = performance.now()
    const loop = () => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const { time, wall } = sample.current
      let d = displayed.current
      let settled = false
      if (playing) {
        const proj = wall > 0 ? time + ((now - wall) / 1000) * rate : time
        d += dt * rate
        const ahead = d - proj
        if (Math.abs(ahead) > SEEK_SNAP) d = proj
        else if (ahead > MAX_AHEAD) d -= dt * rate
        else if (ahead < 0) d += -ahead * FOLLOW
      } else {
        const diff = time - d
        d = Math.abs(diff) > SEEK_SNAP ? time : d + diff * FOLLOW
        settled = Math.abs(time - d) < 0.002
        if (settled) d = time
      }
      displayed.current = d
      cb.current(d)
      if (!settled) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing, rate, currentTime])
}
