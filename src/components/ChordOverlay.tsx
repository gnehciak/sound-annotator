import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectChords } from '../types'
import { degreeColor, spellChord, timeBeat } from '../lib/chords'
import { useSmoothClock } from '../lib/useSmoothClock'
import { useSoundingChord } from '../lib/useSoundingChord'
import { hexA } from './structure/drag'

/**
 * The chord bar on the picture — the strip along the foot of the video that
 * the chord-tutorial channels draw: the progression scrolls right to left
 * past a fixed "now" line, the chord sounding sits lit at that line, and
 * what is coming is readable a few bars ahead. Beats are a fixed fraction
 * of the frame's width (not a fixed time), so a slow song and a fast one
 * both read at the same size, the bar simply moves at the tempo, and full
 * screen scales the whole thing up with the picture.
 *
 * Moves on the frame-rate clock (useSmoothClock), written straight to the
 * track's transform — the players report time four times a second, and a
 * bar stepping at that rate is the one thing this must never do.
 *
 * Built to be cheap under a playing video, which is where it lives. No
 * backdrop blur (a blur the compositor has to redo every frame over moving
 * pixels), no filters, and only the bars within a frame's width of the
 * playhead are in the DOM — the track is a moving layer, and a layer the
 * width of the whole song (tens of thousands of pixels) stops being
 * composited and is repainted each frame instead. The window is recut on
 * the players' coarse ticks; the smooth clock only ever moves it.
 *
 * Inert (`pointer-events-none`) like the lyric overlay beside it, so the
 * player's click-to-pause still lands through it. `placement` is where it
 * sits: along the foot of the frame under the transport (which draws over
 * it while showing, as it does over the picture), or as a block inside the
 * full-screen stage strip, above the song's shape.
 */

/** Where "now" sits, as a fraction of the width — room ahead is what matters. */
const NOW_FRAC = 0.3

export default function ChordOverlay({
  chords,
  currentTime,
  isPlaying,
  rate = 1,
  placement = 'foot',
}: {
  chords: ProjectChords
  currentTime: number
  isPlaying: boolean
  rate?: number
  placement?: 'foot' | 'stage'
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Geometry off the frame: about four bars of 4/4 across the width, and a
  // bar tall enough for its numerals to be read from the back of the room.
  const ppb = Math.max(36, Math.min(120, width / 16))
  const height = Math.max(52, Math.min(112, width * 0.07))

  // The track is placed by the smooth clock, one style write per frame; what
  // it needs is read through a ref so a resize doesn't restart the clock.
  const geo = useRef({ width, ppb, chords })
  const lastT = useRef(currentTime)
  const place = (t: number) => {
    const el = trackRef.current
    if (!el) return
    const { width, ppb, chords } = geo.current
    el.style.transform = `translate3d(${width * NOW_FRAC - timeBeat(chords, t) * ppb}px,0,0)`
  }
  useEffect(() => {
    geo.current = { width, ppb, chords }
    place(lastT.current)
  })
  useSmoothClock(currentTime, isPlaying, rate, (t) => {
    lastT.current = t
    place(t)
  })

  // Only what is near the playhead is in the DOM: a frame's width behind and
  // two ahead, recut once per bar so the window moves in steps the smooth
  // clock's transform hides.
  const nowBeat = timeBeat(chords, currentTime)
  const { beatsPerBar } = chords
  const nowBar = Math.floor(nowBeat / beatsPerBar)
  const span = ppb > 0 ? width / ppb : 16
  const window_ = useMemo(() => {
    const lo = (nowBar - 1) * beatsPerBar - span
    const hi = (nowBar + 1) * beatsPerBar + span * 2
    const bars: { beat: number; n: number }[] = []
    for (let bar = Math.floor(lo / beatsPerBar); bar * beatsPerBar <= hi; bar++)
      bars.push({ beat: bar * beatsPerBar, n: bar + 1 })
    const visible = chords.chords.filter((c) => c.beat + c.len >= lo && c.beat <= hi)
    return { bars, visible }
  }, [chords, nowBar, beatsPerBar, span])

  // Lit off the same clock that moves the bar, so it lights on the beat.
  const soundingId = useSoundingChord(chords, currentTime, isPlaying, rate)
  const numeralPx = Math.round(height * 0.44)
  const namePx = Math.round(height * 0.19)

  return (
    <div
      ref={rootRef}
      aria-hidden
      className={`pointer-events-none overflow-hidden bg-black/60 ${
        placement === 'foot'
          ? 'absolute inset-x-0 bottom-0 z-10'
          : 'relative mb-[0.6em] rounded-md'
      }`}
      style={{ height }}
    >
      <div ref={trackRef} className="absolute inset-y-0 left-0 will-change-transform">
        {window_.bars.map((b) => (
          <span key={b.n} className="absolute inset-y-0" style={{ left: b.beat * ppb }}>
            <span className="absolute inset-y-0 left-0 w-px bg-white/35" />
            {/* Bars before the downbeat keep their line but no number:
                "bar −3" is nothing a class needs to read. */}
            {b.n >= 1 && (
              <span
                className="absolute bottom-[3px] left-1 font-mono leading-none text-white/45"
                style={{ fontSize: Math.max(9, namePx - 2) }}
              >
                {b.n}
              </span>
            )}
            {Array.from({ length: beatsPerBar - 1 }, (_, i) => (
              <span
                key={i}
                className="absolute bottom-0 w-px bg-white/25"
                style={{ left: (i + 1) * ppb, height: Math.round(height * 0.1) }}
              />
            ))}
          </span>
        ))}
        {window_.visible.map((c) => {
          const color = degreeColor(c.degree)
          const s = spellChord(c, chords.key, chords.mode)
          const lit = soundingId === c.id
          return (
            <div
              key={c.id}
              data-lit={lit || undefined}
              className="absolute flex items-center gap-2 overflow-hidden rounded-[4px] border pl-[0.35em]"
              style={{
                top: Math.round(height * 0.09),
                bottom: Math.round(height * 0.09),
                left: c.beat * ppb + 1,
                width: c.len * ppb - 3,
                background: hexA(color, lit ? 0.7 : 0.28),
                borderColor: hexA(color, lit ? 1 : 0.65),
                fontSize: numeralPx,
              }}
            >
              <span className="numeral whitespace-nowrap leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
                {s.roman}
                {s.figure && <sup className="ml-[1px] align-[0.55em] text-[0.42em]">{s.figure}</sup>}
              </span>
              {c.len * ppb > numeralPx * 4 && (
                <span
                  className="mt-[0.2em] whitespace-nowrap font-mono leading-none text-white/80"
                  style={{ fontSize: namePx }}
                >
                  {s.name}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {/* What has been played dims behind the now line. */}
      <div
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-black/45 to-transparent"
        style={{ width: `${NOW_FRAC * 100}%` }}
      />
      <div
        className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-accent"
        style={{ left: `${NOW_FRAC * 100}%` }}
      >
        <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[rgb(var(--accent))]" />
      </div>
    </div>
  )
}
