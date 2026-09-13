import { useMemo } from 'react'
import type { LyricLine } from '../types'
import { clampLyricScale, lyricAt, timedLines } from '../lib/lyrics'

/**
 * The lyrics on the picture: the line being sung, and the one after it
 * fainter beneath, over the lower part of the frame — above the transport's
 * gradient, under nothing. Inert (`pointer-events-none`): the player's own
 * click-to-pause catcher stays reachable through it, like the note stage
 * layer it sits beside in PlayerPane's `overlay` slot.
 *
 * Each arriving line is a new element (keyed by its place in the document),
 * which is what replays the entrance: the previous line is simply gone and
 * the next slides up into its place, which reads as the song reaching it. A
 * rest — an empty line — clears the stage the same way. Only timed lines are
 * ever drawn: an untimed one has no moment to arrive at.
 */
export default function LyricOverlay({
  lines,
  currentTime,
  scale,
}: {
  lines: LyricLine[]
  /** Clip seconds — the clock the stamps were written in. */
  currentTime: number
  /** Type size multiplier — see LYRIC_SCALES. Absent is 1. */
  scale?: number
}) {
  const timed = useMemo(() => timedLines(lines), [lines])
  const { current, next } = lyricAt(timed, currentTime)
  if (!current) return null
  return (
    <div
      aria-live="off"
      className="lyric-stage pointer-events-none absolute inset-x-0 bottom-[14%] z-10"
      style={{ ['--lyric-scale' as string]: clampLyricScale(scale) }}
    >
      <p key={current.index} className="lyric-stage__line animate-lyric-in">
        {current.text}
      </p>
      {next && (
        <p key={`next-${next.index}`} className="lyric-stage__next animate-fade-in">
          {next.text}
        </p>
      )}
    </div>
  )
}
