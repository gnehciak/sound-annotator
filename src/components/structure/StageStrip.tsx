import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { Annotation } from '../../types'
import { formatTime } from '../../lib/format'
import { colorForId } from '../../lib/noteColors'
import { sectionAt, sectionName, sortedSections } from '../../lib/sections'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/** A hex colour with an alpha byte on the end. */
const hexA = (hex: string, a: number) =>
  `${hex}${Math.round(clamp(a, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')}`

/**
 * The song's shape along the foot of the full-screen lyric stage: every
 * section as a band of its own hue, in proportion, with what has played lit
 * and what hasn't dimmed, the playhead over it, and the sounding section
 * named beside the clock. Small on purpose — the picture and the words are
 * the stage; this answers "where are we" for a class watching a projector —
 * and sized to the frame like the words are, so it reads from the back of
 * the room without shouting on a laptop.
 *
 * Click-to-seek, so a hand on the mouse can jump between sections without
 * leaving full screen; that is the one reason it takes the pointer.
 *
 * `children` stack above the shape — the chord bar, which in full screen
 * belongs with the song's map rather than floating on its own.
 *
 * A flush black band across the whole width, down to the bottom edge of the
 * screen: the chord bar, then the section name and the clock, then the
 * song's shape as the last thing before the edge. No gradient, no inset —
 * on a projector the foot of the frame is where the eye rests, and a strip
 * floating in a gradient read as chrome over the picture rather than as the
 * lesson's own readout.
 */
export default function StageStrip({
  sections,
  duration,
  currentTime,
  onSeek,
  children,
}: {
  sections: Annotation[]
  duration: number
  currentTime: number
  onSeek: (t: number) => void
  children?: ReactNode
}) {
  const ordered = sortedSections(sections)
  // The player may not have reported a length yet; the sections know one.
  const dur = Math.max(duration, ...ordered.map((s) => s.end ?? s.start), 1)
  const active = sectionAt(ordered, currentTime)
  const frac = clamp(currentTime / dur, 0, 1)

  const seekAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    if (box.width <= 0) return
    onSeek(clamp((e.clientX - box.left) / box.width, 0, 1) * dur)
  }

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-black"
      style={{ containerType: 'inline-size' }}
    >
      {children}
      <div
        className="flex items-baseline justify-between gap-3 px-[1.2%] py-[0.45em] font-mono uppercase tracking-[0.18em] text-white/65"
        style={{ fontSize: 'clamp(10px, 1.05cqi, 17px)' }}
      >
        <span className="min-w-0 truncate text-white/85">
          {active ? sectionName(active) : ' '}
        </span>
        <span className="shrink-0 tabular-nums">
          {formatTime(currentTime)} / {formatTime(dur)}
        </span>
      </div>
      <div
        onPointerDown={seekAt}
        title="Click to jump"
        className="pointer-events-auto relative w-full cursor-pointer overflow-hidden bg-white/15"
        style={{ height: 'clamp(10px, 1.1cqi, 18px)' }}
      >
        {ordered.map((sec) => {
          const end = sec.end ?? sec.start
          return (
            <div
              key={sec.id}
              aria-hidden
              className="absolute inset-y-0"
              style={{
                left: `${(sec.start / dur) * 100}%`,
                width: `${Math.max(((end - sec.start) / dur) * 100, 0.4)}%`,
                background: hexA(sec.color ?? colorForId(sec.id), 0.9),
              }}
            />
          )
        })}
        {/* What hasn't played yet sits under a dim, so the bar reads as
            progress at a glance and as the form on a second look. */}
        <div
          aria-hidden
          className="absolute inset-y-0 right-0 bg-black/55"
          style={{ width: `${(1 - frac) * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute -inset-y-px w-[2px] bg-white shadow-[0_0_6px_rgb(0_0_0/0.8)]"
          style={{ left: `calc(${frac * 100}% - 1px)` }}
        />
      </div>
    </div>
  )
}
