import { useMemo, useState } from 'react'
// The lyric-video looks set their line in a brush marker face — the app's
// own Plex is a reading face, and a lyric video shouts. Self-hosted like Plex
// (@fontsource); the browser fetches the file only once a glyph asks for it,
// so a track on the caption look never pays for it.
import '@fontsource/permanent-marker/400.css'
import type { Annotation, LyricLine } from '../types'
import { clampLyricScale, lyricAt, lyricStyleOf, timedLines } from '../lib/lyrics'
import { colorForId, hueOnDark } from '../lib/noteColors'
import { sectionAt, sortedSections } from '../lib/sections'

/**
 * The look's class, spelled out per look rather than built from the id:
 * Tailwind drops a component-layer rule whose class never appears literally
 * in the source, and `lyric-stage--${look}` is not a literal.
 */
const LOOK_CLASS = {
  caption: 'lyric-stage--caption',
  pop: 'lyric-stage--pop',
  rise: 'lyric-stage--rise',
  karaoke: 'lyric-stage--karaoke',
} as const

/** A line's words as spans, each carrying its place for the stagger. */
function Words({ text, letters }: { text: string; letters: boolean }) {
  const words = text.split(/\s+/).filter(Boolean)
  let n = 0
  return (
    <>
      {words.map((w, i) => (
        <span key={i} className="lyric-word" style={{ ['--i' as string]: i }}>
          {letters
            ? [...w].map((ch, j) => (
                <span key={j} className="lyric-char" style={{ ['--i' as string]: n++ }}>
                  {ch}
                </span>
              ))
            : w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  )
}

/**
 * The lyrics on the picture. Four looks, chosen per track (`settings.lyricsStyle`):
 * the **caption** — the line being sung over the lower part of the frame with
 * the next one fainter beneath, white with a shadow rather than a box; and
 * three *lyric video* looks that take the middle of the frame — **pop**
 * (brush capitals, a word at a time), **rise** (a letter at a time) and
 * **karaoke** (the line fills left to right over exactly the time until the
 * next line, paused when the player is).
 *
 * Inert (`pointer-events-none`): the player's own click-to-pause catcher
 * stays reachable through it, like the note stage layer it sits beside in
 * PlayerPane's `overlay` slot. Each arriving line is a new element (keyed by
 * its place in the document), which is what replays the entrance; a rest —
 * an empty line — clears the stage the same way. Only timed lines are ever
 * drawn: an untimed one has no moment to arrive at.
 *
 * The karaoke wipe is a CSS animation whose duration is the line's own, and
 * a seek into the middle of a line lands it mid-wipe by starting the
 * animation that far back (a negative delay, fixed once per line so later
 * ticks don't restart it).
 */
export default function LyricOverlay({
  lines,
  currentTime,
  scale,
  style,
  isPlaying = true,
  colorBy,
}: {
  lines: LyricLine[]
  /** Clip seconds — the clock the stamps were written in. */
  currentTime: number
  /** Type size multiplier — see LYRIC_SCALES. Absent is 1. */
  scale?: number
  /** The look — see LYRIC_STYLES. Absent (or unknown) is the caption. */
  style?: string
  /** Karaoke only: the wipe holds while the player does. */
  isPlaying?: boolean
  /**
   * The song's sections, when the words should take the hue of the one each
   * line starts in — lifted for the dark picture, like every note hue on
   * the stage layer. Absent means white.
   */
  colorBy?: Annotation[]
}) {
  const timed = useMemo(() => timedLines(lines), [lines])
  const sections = useMemo(() => (colorBy ? sortedSections(colorBy) : null), [colorBy])
  const { current, next } = lyricAt(timed, currentTime)
  const look = lyricStyleOf(style)
  // Where in its own duration the current line was when it appeared — fixed
  // once per line, so the wipe isn't restarted by every tick of the clock.
  // State adjusted during render (React's shape for state derived from a
  // prop change), keyed on the line so a new line takes a new reading.
  const [wipe, setWipe] = useState<{ index: number; offset: number } | null>(null)
  if (current && wipe?.index !== current.index)
    setWipe({ index: current.index, offset: Math.max(0, currentTime - current.t) })
  if (!current) return null
  const offset =
    wipe?.index === current.index ? wipe.offset : Math.max(0, currentTime - current.t)

  // By the *line's* moment, not the playhead's: a line sung across a section
  // boundary keeps one colour for its whole life.
  const section = sections ? sectionAt(sections, current.t) : undefined
  const vars = {
    ['--lyric-scale' as string]: clampLyricScale(scale),
    ...(section
      ? { ['--lyric-color' as string]: hueOnDark(section.color ?? colorForId(section.id)) }
      : {}),
    ['--lyric-dur' as string]: `${Math.max(0.5, (next ? next.t : current.t + 4) - current.t)}s`,
    ['--lyric-offset' as string]: `-${offset}s`,
  }
  const caption = look === 'caption'
  return (
    <div
      aria-live="off"
      data-paused={!isPlaying || undefined}
      className={`lyric-stage ${LOOK_CLASS[look]} pointer-events-none absolute z-10 ${
        caption ? 'inset-x-0 bottom-[14%]' : 'inset-0'
      }`}
      style={vars}
    >
      <p key={current.index} className={`lyric-stage__line ${caption ? 'animate-lyric-in' : ''}`}>
        {caption || look === 'karaoke' ? current.text : <Words text={current.text} letters={look === 'rise'} />}
      </p>
      {caption && next && (
        <p key={`next-${next.index}`} className="lyric-stage__next animate-fade-in">
          {next.text}
        </p>
      )}
    </div>
  )
}
