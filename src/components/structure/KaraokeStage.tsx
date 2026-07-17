import { useMemo, type CSSProperties } from 'react'
import type { Annotation } from '../../types'
import { formatTime } from '../../lib/format'
import { colorForId, hueText } from '../../lib/noteColors'
import { useResolvedTheme } from '../../lib/theme'
import { sectionAt, sectionName, sortedSections } from '../../lib/sections'

/**
 * Karaoke mode: the player's box, given over to the sounding section's lyrics
 * at singing size. Lyrics are whole-section (see LyricsPanel), so the stage
 * turns over at section boundaries rather than highlighting a line — the
 * chorus lands as one page, the way a lyric sheet holds it.
 *
 * The video keeps playing behind this (its iframe stays mounted, just
 * clipped), so the stage is a *view* of the same transport, never a second
 * one: the header seeks, the rail reads out how much section is left, and
 * every other control on the board still drives it.
 */

interface Props {
  /** The project's sections (all of its annotations, in any order). */
  sections: Annotation[]
  currentTime: number
  isPlaying: boolean
  /** Sized for a room rather than a panel — set when the stage is fullscreen. */
  large?: boolean
  onSeek: (t: number) => void
}

export default function KaraokeStage({
  sections,
  currentTime,
  isPlaying,
  large = false,
  onSeek,
}: Props) {
  const theme = useResolvedTheme()
  const ordered = useMemo(() => sortedSections(sections), [sections])
  const active = sectionAt(ordered, currentTime)
  const next = ordered.find((s) => s.start > currentTime)

  const color = active ? (active.color ?? colorForId(active.id)) : null
  const ink = color ? hueText(color, theme) : null

  // How far through the sounding section we are — the rail's fill.
  const end = active?.end ?? active?.start ?? 0
  const span = active ? Math.max(0.001, end - active.start) : 0
  const progress = active
    ? Math.min(1, Math.max(0, (currentTime - active.start) / span))
    : 0

  const lyrics = active?.lyrics?.trim() ?? ''

  return (
    // No aria-live: the sheet beside it already carries every section's
    // lyrics as readable text, and announcing a whole verse on each
    // turn-over would talk over the song rather than help anyone sing it.
    <section
      aria-label="Karaoke lyric stage"
      className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-inset"
    >
      {/* Header: which section is sounding, and what follows it. */}
      <div className="flex shrink-0 items-baseline justify-between gap-3 px-4 pt-3.5">
        {active ? (
          <button
            type="button"
            onClick={() => onSeek(active.start)}
            title={`Replay this section (${formatTime(active.start)})`}
            className="press flex min-w-0 items-baseline gap-2 text-left"
          >
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 self-center rounded-full ${
                isPlaying ? 'animate-now-pulse' : ''
              }`}
              style={{ background: color! }}
            />
            <span
              className={`truncate font-mono font-semibold uppercase tracking-[0.14em] ${
                large ? 'text-[15px]' : 'text-[11px]'
              }`}
              style={{ color: ink! }}
            >
              {sectionName(active)}
            </span>
            <span
              className={`shrink-0 font-mono tabular-nums text-muted ${
                large ? 'text-[13px]' : 'text-[10px]'
              }`}
            >
              {formatTime(active.start)}
            </span>
          </button>
        ) : (
          <span
            className={`font-mono font-semibold uppercase tracking-[0.14em] text-muted ${
              large ? 'text-[15px]' : 'text-[11px]'
            }`}
          >
            {ordered.length === 0 ? 'No sections' : 'Between sections'}
          </span>
        )}

        {next && (
          <span
            className={`shrink-0 truncate font-mono uppercase tracking-[0.14em] text-muted ${
              large ? 'text-[13px]' : 'text-[10px]'
            }`}
          >
            Next · {sectionName(next)}
          </span>
        )}
      </div>

      {/* The sheet, keyed on the section so each turn-over crossfades. It is
          the size container the lyrics are set against (see lyricStyle) —
          the sheet rather than the whole stage, because the header and rail
          are a fixed height no percentage of the stage could account for.
          `m-auto` on the child rather than `items-center` here: a centred
          flex item that outgrows its scroll box is clipped at *both* ends,
          and the top of it can't be scrolled back to. */}
      <div
        key={active?.id ?? 'none'}
        style={{ containerType: 'size' }}
        className="flex min-h-0 flex-1 animate-fade-in overflow-y-auto px-6 py-2"
      >
        {lyrics ? (
          <p
            style={lyricStyle(lyrics)}
            className="m-auto w-full max-w-[46ch] whitespace-pre-wrap text-center font-semibold leading-[1.45] text-fg-strong"
          >
            {lyrics}
          </p>
        ) : (
          <p
            className={`m-auto max-w-[40ch] text-balance text-center leading-relaxed text-muted ${
              large ? 'text-[18px]' : 'text-[13px]'
            }`}
          >
            {emptyMessage(ordered.length, active, next)}
          </p>
        )}
      </div>

      {/* Section rail: how much of this section is left to sing. */}
      <div className="h-[3px] shrink-0 bg-line/60">
        {active && (
          <div
            className="h-full"
            style={{
              background: color!,
              width: `${progress * 100}%`,
            }}
          />
        )}
      </div>
    </section>
  )
}

/**
 * Set a section's lyrics to the biggest size that still fits the stage, so a
 * four-line chorus fills the room and a sixteen-line verse still lands whole
 * — scrolling is the one thing nobody can do while singing.
 *
 * Two ceilings against the sheet's box, whichever is tighter: height
 * (`62cqh / lines` — at 1.45 leading that leaves the block just inside the
 * box and its padding) and width (`4.2cqw` keeps a full 46ch line off the
 * edges, since wrapping would add lines the height math didn't count). Line
 * *count* drives it rather than a measurement, so the size holds steady
 * through a section instead of resizing under the reader.
 */
function lyricStyle(lyrics: string): CSSProperties {
  const lines = lyrics.split('\n').length
  return {
    fontSize: `clamp(15px, min(calc(62cqh / ${lines}), 4.2cqw), 54px)`,
  }
}

/** What the stage says when there are no lyrics to show yet. */
function emptyMessage(
  count: number,
  active: Annotation | undefined,
  next: Annotation | undefined,
): string {
  if (count === 0) return 'Draw sections on the timeline, then give them lyrics.'
  if (active) return `No lyrics written for ${sectionName(active)} yet.`
  if (next) return `${sectionName(next)} starts at ${formatTime(next.start)}.`
  return 'Nothing more to sing — the last section has ended.'
}
