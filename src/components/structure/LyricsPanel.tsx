import { useEffect, useRef } from 'react'
import type { Annotation } from '../../types'
import { formatTime } from '../../lib/format'
import { colorForId, hueText } from '../../lib/noteColors'
import { useResolvedTheme } from '../../lib/theme'
import { sectionAt, sectionName, sortedSections } from '../../lib/sections'
import TitleBar from '../TitleBar'

/**
 * The structure board's right column: a lyric sheet. Whole-section lyrics
 * (deliberately not line-synced) set like a score page — generous spacing
 * instead of dividers, one thin hue rail per section as its identity mark,
 * the section name in its own hue. While the song plays, the sounding
 * section stays lit and the others fall back, karaoke-sheet style, and the
 * sheet follows the playhead by itself. Click any heading to play from there.
 */

interface Props {
  /** The project's sections (all of its annotations, in any order). */
  sections: Annotation[]
  currentTime: number
  isPlaying: boolean
  readOnly: boolean
  onSeek: (t: number) => void
  onUpdateLyrics: (id: string, lyrics: string) => void
}

export default function LyricsPanel({
  sections,
  currentTime,
  isPlaying,
  readOnly,
  onSeek,
  onUpdateLyrics,
}: Props) {
  const theme = useResolvedTheme()
  const ordered = sortedSections(sections)
  const activeId = sectionAt(ordered, currentTime)?.id ?? null
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the song: bring the sounding section into view while playing —
  // but never yank the sheet out from under someone typing or selecting in it.
  useEffect(() => {
    if (!isPlaying || !activeId) return
    const panel = scrollRef.current
    if (!panel || panel.contains(document.activeElement)) return
    document
      .getElementById(`lyrics-${activeId}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId, isPlaying])

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <TitleBar left="Lyrics" />
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-note">
        {ordered.length === 0 ? (
          <p className="px-5 py-10 text-center text-[12.5px] leading-relaxed text-muted">
            Draw sections on the timeline first — their lyrics go here.
          </p>
        ) : (
          <div className="space-y-1 px-2.5 py-3">
            {ordered.map((sec) => {
              const color = sec.color ?? colorForId(sec.id)
              const ink = hueText(color, theme)
              const active = sec.id === activeId
              // Karaoke focus: while the song plays, only the sounding
              // section stays lit. At rest the whole sheet reads evenly.
              const dimmed = isPlaying && activeId !== null && !active
              const lyrics = sec.lyrics ?? ''
              if (readOnly && !lyrics.trim()) return null
              return (
                <section
                  key={sec.id}
                  id={`lyrics-${sec.id}`}
                  aria-label={`${sectionName(sec)} lyrics`}
                  className={`relative rounded-md py-3 pl-4 pr-3 transition-[background-color,opacity] duration-300 ${
                    active ? 'bg-rowsel' : ''
                  } ${dimmed ? 'opacity-50' : ''}`}
                >
                  {/* The section's identity rail — its hue, nothing else. */}
                  <span
                    aria-hidden
                    className="absolute bottom-3 left-1 top-3 w-[2px] rounded-full"
                    style={{ background: color }}
                  />
                  <button
                    type="button"
                    onClick={() => onSeek(sec.start)}
                    title={`Play from here (${formatTime(sec.start)})`}
                    className="press flex w-full min-w-0 items-baseline gap-2 text-left"
                  >
                    <span
                      className="truncate font-mono text-[11px] font-semibold uppercase tracking-[0.14em]"
                      style={{ color: ink }}
                    >
                      {sectionName(sec)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
                      {formatTime(sec.start)}
                    </span>
                    {active && (
                      <span
                        aria-label="Now playing"
                        className={`ml-auto h-1.5 w-1.5 shrink-0 self-center rounded-full bg-accent ${
                          isPlaying ? 'animate-now-pulse' : ''
                        }`}
                      />
                    )}
                  </button>
                  {readOnly ? (
                    <p className="mt-1.5 max-w-[62ch] whitespace-pre-wrap text-[13.5px] leading-[1.75] text-fg">
                      {lyrics}
                    </p>
                  ) : (
                    <GrowingTextarea
                      value={lyrics}
                      onChange={(v) => onUpdateLyrics(sec.id, v)}
                      ariaLabel={`Lyrics for ${sectionName(sec)}`}
                    />
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Borderless textarea that grows with its content, so every section's
 *  lyrics sit fully visible in the flow — no inner scrollbars. */
function GrowingTextarea({
  value,
  onChange,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      el.style.height = 'auto'
      const h = el.scrollHeight
      // A 0 reading means we measured before layout (or while hidden) —
      // leave height auto rather than pinning the field to 0px.
      if (h > 0) el.style.height = `${h}px`
    }
    fit()
    if (el.scrollHeight > 0) return
    const raf = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Paste lyrics…"
      aria-label={ariaLabel}
      className="mt-1.5 block w-full max-w-[62ch] resize-none overflow-hidden rounded-sm bg-transparent text-[13.5px] leading-[1.75] text-fg outline-none transition-colors placeholder:text-muted/60 hover:bg-fg/5 focus:bg-fg/5"
    />
  )
}
