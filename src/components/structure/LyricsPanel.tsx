import { useCallback, useEffect, useRef, useState } from 'react'
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
 * section stays lit and the others fall back, karaoke-sheet style.
 * (Chords are painted directly in the Chords player band, not here.)
 *
 * Auto-pin: whenever the sounding section changes — playback rolling into
 * the next section, or any seek (ruler, chips, a lyric heading) — and again
 * when Play is pressed, the sheet scrolls that section to its top, like the
 * notes list pinning the playing note. A measured bottom spacer lets even
 * the last section pin, and the pin stands down while the caret is in the
 * sheet so it never yanks the page out from under someone typing.
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
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  // Bottom spacer so the last sections can still pin to the panel top.
  const [pad, setPad] = useState(0)

  const setScrollEl = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    roRef.current?.disconnect()
    if (!el) return
    const update = () => setPad(Math.max(0, el.clientHeight - 96))
    update()
    roRef.current = new ResizeObserver(update)
    roRef.current.observe(el)
  }, [])

  /** Scroll the sounding section to the top of the sheet. */
  const activeIdRef = useRef(activeId)
  useEffect(() => {
    activeIdRef.current = activeId
  })
  const pinActive = useCallback(() => {
    const panel = scrollRef.current
    const id = activeIdRef.current
    if (!panel || !id) return
    // Never yank the sheet out from under someone typing in it.
    if (panel.contains(document.activeElement)) return
    const el = document.getElementById(`lyrics-${id}`)
    if (!el) return
    const top =
      el.getBoundingClientRect().top -
      panel.getBoundingClientRect().top +
      panel.scrollTop -
      6
    panel.scrollTo({
      top: Math.max(0, top),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }, [])

  // Pin whenever the sounding section changes — that covers playback rolling
  // across a boundary AND any seek, playing or paused…
  useEffect(() => {
    if (activeId) pinActive()
  }, [activeId, pinActive])
  // …and when Play is pressed, re-pin the section already sounding.
  useEffect(() => {
    if (isPlaying) pinActive()
  }, [isPlaying, pinActive])

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <TitleBar left="Lyrics" />
      <div ref={setScrollEl} className="flex-1 overflow-y-auto bg-note">
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
                    lyrics.trim() && (
                      <p className="mt-1.5 max-w-[62ch] whitespace-pre-wrap text-[13.5px] leading-[1.75] text-fg">
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
            })}
            {/* Lets the last section scroll all the way to the panel top. */}
            <div aria-hidden style={{ height: pad }} />
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
