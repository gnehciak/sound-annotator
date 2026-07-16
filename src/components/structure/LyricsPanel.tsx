import { useEffect, useRef } from 'react'
import type { Annotation } from '../../types'
import { noteLabel } from '../../lib/format'
import { colorForId } from '../../lib/noteColors'
import { sectionAt, sectionName, sortedSections } from '../../lib/sections'
import TitleBar from '../TitleBar'

/**
 * The structure board's right column: whole-section lyrics, stacked in
 * timeline order. Each section is a flush row in the note-list language —
 * 3px colour spine, name chip, clickable timecode — over a paste-in lyrics
 * body (plain text, section granularity; deliberately not line-synced).
 * The sounding section tints like the playing note row and the list follows
 * it during playback, so projected lyrics track the song by themselves.
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
  const ordered = sortedSections(sections)
  const activeId = sectionAt(ordered, currentTime)?.id ?? null
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the song: bring the sounding section into view while playing —
  // but never yank the list out from under someone typing or selecting in it.
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
      <TitleBar
        left="Lyrics"
        right={`${ordered.filter((a) => a.lyrics?.trim()).length} / ${ordered.length}`}
      />
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-note">
        {ordered.length === 0 ? (
          <p className="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Sketch sections on the timeline first
          </p>
        ) : (
          ordered.map((sec) => {
            const color = sec.color ?? colorForId(sec.id)
            const active = sec.id === activeId
            const lyrics = sec.lyrics ?? ''
            return (
              <section
                key={sec.id}
                id={`lyrics-${sec.id}`}
                aria-label={`${sectionName(sec)} lyrics`}
                className={`relative border-b border-line py-2.5 pl-4 pr-3.5 transition-colors duration-150 ${
                  active ? 'bg-rowsel' : ''
                }`}
              >
                {/* Identity spine, exactly the note rows' device. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: color }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSeek(sec.start)}
                    title={`Play from ${sectionName(sec)} (${noteLabel(sec.start, sec.end)})`}
                    className="press flex min-w-0 items-center gap-2"
                  >
                    <span
                      className="truncate rounded-sm px-1.5 py-[2px] font-mono text-[10px] font-semibold leading-none text-onbright"
                      style={{ background: color }}
                    >
                      {sectionName(sec)}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted">
                      {noteLabel(sec.start, sec.end)}
                    </span>
                  </button>
                  {active && (
                    <span
                      aria-label="Now playing"
                      className={`h-1.5 w-1.5 shrink-0 rounded-full bg-accent ${
                        isPlaying ? 'animate-now-pulse' : ''
                      }`}
                    />
                  )}
                </div>
                {readOnly ? (
                  lyrics.trim() && (
                    <p className="mt-1.5 max-w-[65ch] whitespace-pre-wrap text-[13px] leading-relaxed text-fg">
                      {lyrics}
                    </p>
                  )
                ) : (
                  <GrowingTextarea
                    value={lyrics}
                    onChange={(v) => onUpdateLyrics(sec.id, v)}
                    ariaLabel={`Lyrics for ${sectionName(sec)}`}
                  />
                )}
              </section>
            )
          })
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
      placeholder="Paste this section’s lyrics…"
      aria-label={ariaLabel}
      className="mt-1.5 block w-full max-w-[65ch] resize-none overflow-hidden rounded-sm bg-transparent text-[13px] leading-relaxed text-fg outline-none transition-colors placeholder:text-muted/70 hover:bg-fg/5 focus:bg-fg/5"
    />
  )
}
