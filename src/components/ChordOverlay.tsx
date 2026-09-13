import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectChords } from '../types'
import { chordAt, degreeColor, spellChord, timeBeat } from '../lib/chords'
import { useSmoothClock } from '../lib/useSmoothClock'
import { hexA } from './structure/drag'

/**
 * The chord bar on the picture — the strip along the foot of the video that
 * the chord-tutorial channels draw: the progression scrolls right to left
 * past a fixed "now" line, the chord sounding sits lit at that line, and
 * what is coming is readable a few bars ahead. Beats are a fixed width on
 * the screen (not a fixed time), so a slow song and a fast one both read at
 * the same size and the bar simply moves at the tempo.
 *
 * Moves on the frame-rate clock (useSmoothClock), written straight to the
 * track's transform — the players report time four times a second, and a
 * bar stepping at that rate is the one thing this must never do. Inert
 * (`pointer-events-none`) like the lyric overlay beside it, so the player's
 * click-to-pause still lands through it; sits under the transport (z-20),
 * which draws over it while it is showing, as it does over the picture.
 */

/** Screen pixels per beat: a 4/4 bar is 224px, about six bars on a 16:9 frame. */
const PPB = 56
/** Where "now" sits, as a fraction of the width — room ahead is what matters. */
const NOW_FRAC = 0.3

export default function ChordOverlay({
  chords,
  currentTime,
  duration,
  isPlaying,
  rate = 1,
}: {
  chords: ProjectChords
  currentTime: number
  duration: number
  isPlaying: boolean
  rate?: number
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

  // The track is placed by the smooth clock, one style write per frame; the
  // width it needs is read through a ref so a resize doesn't restart it.
  const geo = useRef({ width, chords })
  const lastT = useRef(currentTime)
  const place = (t: number) => {
    const el = trackRef.current
    if (!el) return
    const { width, chords } = geo.current
    el.style.transform = `translateX(${width * NOW_FRAC - timeBeat(chords, t) * PPB}px)`
  }
  useEffect(() => {
    geo.current = { width, chords }
    place(lastT.current)
  })
  useSmoothClock(currentTime, isPlaying, rate, (t) => {
    lastT.current = t
    place(t)
  })

  // Bar lines for the whole song, once: a few bars before the first downbeat
  // (a pickup) through the end of the recording.
  const bars = useMemo(() => {
    const { beatsPerBar } = chords
    const first = Math.floor(Math.min(0, ...chords.chords.map((c) => c.beat)) / beatsPerBar) - 2
    const lastBeat = Math.max(
      timeBeat(chords, Math.max(duration, 0)),
      ...chords.chords.map((c) => c.beat + c.len),
    )
    const last = Math.ceil(lastBeat / beatsPerBar) + 1
    const out: { beat: number; n: number }[] = []
    for (let bar = first; bar <= last && out.length < 600; bar++)
      out.push({ beat: bar * beatsPerBar, n: bar + 1 })
    return out
  }, [chords, duration])

  const sounding = chordAt(chords.chords, timeBeat(chords, currentTime))

  return (
    <div
      ref={rootRef}
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[58px] overflow-hidden bg-black/60 backdrop-blur-sm"
    >
      <div ref={trackRef} className="absolute inset-y-0 left-0 will-change-transform">
        {bars.map((b) => (
          <span key={b.n} className="absolute inset-y-0" style={{ left: b.beat * PPB }}>
            <span className="absolute inset-y-0 left-0 w-px bg-white/35" />
            <span className="absolute bottom-[3px] left-1 font-mono text-[9px] leading-none text-white/45">
              {b.n}
            </span>
            {Array.from({ length: chords.beatsPerBar - 1 }, (_, i) => (
              <span
                key={i}
                className="absolute bottom-0 h-[6px] w-px bg-white/25"
                style={{ left: (i + 1) * PPB }}
              />
            ))}
          </span>
        ))}
        {chords.chords.map((c) => {
          const color = degreeColor(c.degree)
          const s = spellChord(c, chords.key, chords.mode)
          const lit = sounding?.id === c.id
          return (
            <div
              key={c.id}
              data-lit={lit || undefined}
              className="absolute inset-y-[5px] flex items-center gap-2 overflow-hidden rounded-[4px] border pl-2 transition-[filter,opacity] duration-150"
              style={{
                left: c.beat * PPB + 1,
                width: c.len * PPB - 3,
                background: hexA(color, lit ? 0.62 : 0.3),
                borderColor: hexA(color, lit ? 1 : 0.7),
                opacity: lit ? 1 : 0.85,
                filter: lit ? 'brightness(1.15)' : undefined,
              }}
            >
              <span className="numeral whitespace-nowrap text-[26px] leading-none text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
                {s.roman}
                {s.figure && <sup className="ml-[1px] align-[0.55em] text-[11px]">{s.figure}</sup>}
              </span>
              {c.len * PPB > 96 && (
                <span className="mt-[4px] whitespace-nowrap font-mono text-[11px] leading-none text-white/80">
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
        className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-accent shadow-[0_0_8px_rgb(var(--accent)/0.7)]"
        style={{ left: `${NOW_FRAC * 100}%` }}
      >
        <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[rgb(var(--accent))]" />
      </div>
    </div>
  )
}
