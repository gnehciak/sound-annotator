import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AArrowDown,
  AArrowUp,
  Check,
  Crosshair,
  Eye,
  EyeOff,
  Maximize2,
  Minus,
  Play,
  Plus,
  SlidersHorizontal,
  Timer as TimerIcon,
  Trash2,
} from 'lucide-react'
import type { Annotation, LyricLine } from '../../types'
import { formatTenths, formatTime, parseTime } from '../../lib/format'
import {
  groupBySection,
  insertLineAfter,
  LYRIC_SCALES,
  LYRIC_STYLES,
  lyricStyleOf,
  MAX_LYRIC_DIM,
  nudgeLine,
  removeLine,
  setLineText,
  stampLine,
  stepLyricScale,
  timedIndexAt,
  timedLines,
} from '../../lib/lyrics'
import { colorForId, hueText } from '../../lib/noteColors'
import { useResolvedTheme } from '../../lib/theme'
import { sectionAt, sectionName, sortedSections } from '../../lib/sections'
import TitleBar from '../TitleBar'
import Popover from '../Popover'
import LyricTimer from './LyricTimer'

/**
 * The structure board's right column: the lyric sheet. The track's lines
 * (`settings.lyrics`, see lib/lyrics.ts) filed under the section each one
 * starts in, so the sheet reads as the song's form with the words inside it —
 * every section is listed, lyrics or not, and lines that start between
 * sections sit in a heading-less run where they fall. Lines still waiting
 * for a stamp gather at the foot under "Not timed", since they have no place
 * on the clock yet.
 *
 * While the song plays the line being sung is lit and the sheet scrolls to
 * keep it in view, karaoke-sheet style, standing down whenever the caret is
 * in the sheet so it never yanks a line out from under someone typing. The
 * sections not sounding fall back while playing, as before.
 *
 * Editing is per line, and every control is second-precise: the time chip
 * becomes a field when its row is selected (type `1:23.4`, Enter), a
 * crosshair stamps the row at the playhead, ± nudge it by half a second.
 * Enter in a line's words opens a new line under it; Backspace on an empty
 * one removes it. The timing *pass* — paste it all, press → per line — is
 * the LyricTimer workspace, which takes this column over from the Time key.
 */

interface Props {
  lines: LyricLine[]
  /** The project's sections (all of its annotations, in any order). */
  sections: Annotation[]
  currentTime: number
  isPlaying: boolean
  readOnly: boolean
  /**
   * Whether the lines are drawn on the video, and the switch for it. Absent
   * on an audio track — its waveform is the picture and there is nothing to
   * draw on.
   */
  onVideo?: boolean
  onToggleOnVideo?: () => void
  /** The overlay's type size (see LYRIC_SCALES) and the way to change it. */
  scale?: number
  onScale?: (scale: number) => void
  /** The overlay's look (see LYRIC_STYLES) and the way to change it. */
  style?: string
  onStyle?: (style: string) => void
  /** The veil over the picture under the lyrics, 0–MAX_LYRIC_DIM. */
  dim?: number
  onDim?: (dim: number) => void
  /** Colour the words in their section's hue rather than white. */
  sectionColor?: boolean
  onSectionColor?: (on: boolean) => void
  /** Take the picture and the words full screen — video tracks only. */
  onFullscreen?: () => void
  onSeek: (t: number) => void
  onPlayPause: () => void
  onChange: (lines: LyricLine[], opts?: { coalesceKey?: string }) => void
}

export default function LyricsPanel({
  lines,
  sections,
  currentTime,
  isPlaying,
  readOnly,
  onVideo,
  onToggleOnVideo,
  scale = 1,
  onScale,
  style,
  onStyle,
  dim = 0,
  onDim,
  sectionColor = false,
  onSectionColor,
  onFullscreen,
  onSeek,
  onPlayPause,
  onChange,
}: Props) {
  const theme = useResolvedTheme()
  const [timing, setTiming] = useState(false)
  // The row whose controls are out. Cleared when the list changes shape under
  // it, so the controls can never point at a line that has moved.
  const [selected, setSelected] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const styleBtnRef = useRef<HTMLButtonElement | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  // A line just opened under another wants the caret; found by index once
  // the list has re-rendered with it in.
  const pendingFocus = useRef<number | null>(null)

  const { groups, untimed } = useMemo(
    () => groupBySection(lines, sections),
    [lines, sections],
  )
  const timed = useMemo(() => timedLines(lines), [lines])
  const soundingAt = timedIndexAt(timed, currentTime)
  const sounding = soundingAt >= 0 ? timed[soundingAt].index : null
  const activeSectionId = useMemo(
    () => sectionAt(sortedSections(sections), currentTime)?.id ?? null,
    [sections, currentTime],
  )

  // Keep the sung line in view — or, between lines, the sounding section's
  // heading — whenever either changes, and again when Play is pressed.
  const pinTarget = sounding != null ? `lyric-${sounding}` : activeSectionId ? `lyrics-${activeSectionId}` : null
  const pinTargetRef = useRef(pinTarget)
  useEffect(() => {
    pinTargetRef.current = pinTarget
  })
  const pin = () => {
    const panel = scrollRef.current
    const id = pinTargetRef.current
    if (!panel || !id) return
    if (panel.contains(document.activeElement)) return
    const el = document.getElementById(id)
    if (!el || !panel.contains(el)) return
    el.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    })
  }
  useEffect(() => {
    if (pinTarget) pin()
  }, [pinTarget])
  useEffect(() => {
    if (isPlaying) pin()
  }, [isPlaying])

  useEffect(() => {
    const i = pendingFocus.current
    if (i == null) return
    pendingFocus.current = null
    scrollRef.current
      ?.querySelector<HTMLInputElement>(`input[data-line="${i}"]`)
      ?.focus()
  }, [lines])

  const edit = (next: LyricLine[], opts?: { coalesceKey?: string }) => {
    onChange(next, opts)
  }

  if (timing && !readOnly) {
    return (
      <LyricTimer
        lines={lines}
        currentTime={currentTime}
        isPlaying={isPlaying}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onChange={(next) => edit(next)}
        onClose={() => setTiming(false)}
      />
    )
  }

  const rowProps = (index: number, t: number | undefined, text: string) => ({
    index,
    t,
    text,
    sounding: index === sounding,
    selected: index === selected,
    readOnly,
    currentTime,
    onSeek,
    onSelect: () => setSelected(index),
    onText: (v: string) =>
      edit(setLineText(lines, index, v), { coalesceKey: `lyric-text:${index}` }),
    onStamp: (at: number) => edit(stampLine(lines, index, at)),
    onNudge: (by: number) => edit(nudgeLine(lines, index, by)),
    onInsertAfter: () => {
      pendingFocus.current = index + 1
      edit(insertLineAfter(lines, index))
      setSelected(index + 1)
    },
    onRemove: () => {
      edit(removeLine(lines, index))
      setSelected(null)
      if (index > 0) pendingFocus.current = index - 1
    },
  })

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <TitleBar
        left="Lyrics"
        actions={
          <>
            {/* The picture's controls — size, show/hide, full screen — only
                once there are words to put on it, and only on a video. */}
            {onToggleOnVideo && lines.length > 0 && (
              <>
                {onScale && (
                  <>
                    <button
                      type="button"
                      onClick={() => onScale(stepLyricScale(scale, -1))}
                      disabled={scale <= LYRIC_SCALES[0]}
                      title="Smaller lyrics on the video"
                      aria-label="Smaller lyrics on the video"
                      className="btn-icon press disabled:opacity-30"
                    >
                      <AArrowDown size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onScale(stepLyricScale(scale, 1))}
                      disabled={scale >= LYRIC_SCALES[LYRIC_SCALES.length - 1]}
                      title="Bigger lyrics on the video"
                      aria-label="Bigger lyrics on the video"
                      className="btn-icon press disabled:opacity-30"
                    >
                      <AArrowUp size={15} />
                    </button>
                  </>
                )}
                {onStyle && (
                  <>
                    <button
                      ref={styleBtnRef}
                      type="button"
                      onClick={() => setStyleOpen((o) => !o)}
                      aria-expanded={styleOpen}
                      title="How the lyrics look on the video"
                      aria-label="Lyric style"
                      className="btn-icon press"
                    >
                      <SlidersHorizontal size={14} />
                    </button>
                    <Popover
                      open={styleOpen}
                      anchorRef={styleBtnRef}
                      onClose={() => setStyleOpen(false)}
                      width={250}
                    >
                      <div className="py-1">
                        {LYRIC_STYLES.map((s) => {
                          const on = lyricStyleOf(style) === s.id
                          return (
                            <button
                              key={s.id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={on}
                              onClick={() => {
                                onStyle(s.id)
                                setStyleOpen(false)
                              }}
                              className={`pop-row ${on ? 'text-fg' : ''}`}
                            >
                              <span className="flex w-4 shrink-0 justify-center">
                                {on && <Check size={13} />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-fg">{s.label}</span>
                                <span className="block text-[11px] leading-snug text-muted">
                                  {s.detail}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                        {onSectionColor && (
                          <>
                            <div className="my-1 border-t border-line/60" />
                            <button
                              type="button"
                              onClick={() => onSectionColor(!sectionColor)}
                              aria-pressed={sectionColor}
                              title="Each line takes the colour of the section it starts in"
                              className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-raised"
                            >
                              <span className={`text-[12px] ${sectionColor ? 'text-fg' : 'text-muted'}`}>
                                Colour by section
                              </span>
                              <span className="switch" data-on={sectionColor || undefined} />
                            </button>
                          </>
                        )}
                        {onDim && (
                          <>
                            <div className="my-1 border-t border-line/60" />
                            {/* The veil: a lyric video darkens its picture
                                so the words own the frame; a class watching
                                the video wants it lighter. One slider. */}
                            <label className="flex items-center gap-2 px-2.5 py-1.5">
                              <span className="shrink-0 text-[12px] text-muted">Dim video</span>
                              <input
                                type="range"
                                min={0}
                                max={Math.round(MAX_LYRIC_DIM * 100)}
                                step={5}
                                value={Math.round(dim * 100)}
                                onChange={(e) => onDim(Number(e.target.value) / 100)}
                                aria-label="Dim the video under the lyrics"
                                className="flex-1 accent-accent"
                              />
                              <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
                                {Math.round(dim * 100)}%
                              </span>
                            </label>
                          </>
                        )}
                      </div>
                    </Popover>
                  </>
                )}
                <button
                  type="button"
                  onClick={onToggleOnVideo}
                  aria-pressed={onVideo}
                  title={onVideo ? 'Hide the lyrics on the video' : 'Show the lyrics on the video'}
                  className="btn-icon press"
                >
                  {onVideo ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                {onFullscreen && (
                  <button
                    type="button"
                    onClick={onFullscreen}
                    title="Full screen — just the video and the lyrics (F, Esc to leave)"
                    aria-label="Full screen lyrics"
                    className="btn-icon press"
                  >
                    <Maximize2 size={13} />
                  </button>
                )}
              </>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => setTiming(true)}
                title={
                  lines.length > 0
                    ? 'Time the lines against the song, one key press per line'
                    : 'Paste the lyrics and time them against the song'
                }
                className="btn-ghost btn-sm press shrink-0"
              >
                <TimerIcon size={12} />
                {lines.length > 0 ? 'Time' : 'Paste lyrics'}
              </button>
            )}
          </>
        }
      />
      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-note">
        {lines.length === 0 ? (
          <div className="px-4 py-6">
            <div className="empty">
              <p className="text-[12.5px] leading-relaxed text-muted">
                {readOnly
                  ? 'This track has no lyrics.'
                  : 'No lyrics yet. Paste the whole lyric, then press → as each line begins — the lines file themselves under the sections they fall in.'}
              </p>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setTiming(true)}
                  className="btn-signal press"
                >
                  <TimerIcon size={12} />
                  Paste lyrics
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2 px-2 py-3">
            {groups.map((g, gi) => {
              const sec = g.section
              // A reader is here for the words: a section with none is one
              // heading of noise to them, and a fact to the person editing.
              if (readOnly && g.lines.length === 0) return null
              if (!sec) {
                return (
                  <section key={`orphans-${gi}`} className="rounded-md px-1 py-1">
                    <div className="px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                      Between sections
                    </div>
                    <ul>
                      {g.lines.map((l) => (
                        <LyricRow key={l.index} {...rowProps(l.index, l.t, l.text)} />
                      ))}
                    </ul>
                  </section>
                )
              }
              const color = sec.color ?? colorForId(sec.id)
              const ink = hueText(color, theme)
              const active = sec.id === activeSectionId
              // Karaoke focus: while the song plays, only the sounding
              // section stays lit. At rest the whole sheet reads evenly.
              const dimmed = isPlaying && activeSectionId !== null && !active
              return (
                <section
                  key={sec.id}
                  id={`lyrics-${sec.id}`}
                  aria-label={`${sectionName(sec)} lyrics`}
                  className={`relative rounded-md py-1.5 pl-3.5 pr-1 transition-opacity duration-300 ${
                    dimmed ? 'opacity-50' : ''
                  }`}
                >
                  {/* The section's identity rail — its hue, nothing else. */}
                  <span
                    aria-hidden
                    className="absolute bottom-2 left-1 top-2 w-[2px] rounded-full"
                    style={{ background: color }}
                  />
                  <button
                    type="button"
                    onClick={() => onSeek(sec.start)}
                    title={`Play from here (${formatTime(sec.start)})`}
                    className="press flex w-full min-w-0 items-baseline gap-2 px-1 py-0.5 text-left"
                  >
                    <span
                      className="chip max-w-full truncate font-semibold"
                      style={{ ['--hue' as string]: color, color: ink }}
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
                  {g.lines.length === 0 ? (
                    <p className="px-1.5 py-1 text-[11px] italic text-muted">
                      No lyrics start in this section.
                    </p>
                  ) : (
                    <ul className="mt-0.5">
                      {g.lines.map((l) => (
                        <LyricRow key={l.index} {...rowProps(l.index, l.t, l.text)} />
                      ))}
                    </ul>
                  )}
                </section>
              )
            })}

            {untimed.length > 0 && (
              <section className="rounded-md px-1 py-1" aria-label="Lines not yet timed">
                <div className="flex items-center justify-between gap-2 px-1.5 pb-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
                    Not timed
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setTiming(true)}
                      className="btn-ghost btn-sm press shrink-0"
                    >
                      <TimerIcon size={12} />
                      Time these
                    </button>
                  )}
                </div>
                <ul>
                  {untimed.map((l) => (
                    <LyricRow key={l.index} {...rowProps(l.index, undefined, l.text)} />
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One line of the sheet: its stamp, its words, and — on the selected row,
 * when editing — the controls that retime or remove it. One fixed-height row
 * whichever state it is in, so selecting a line moves nothing under the
 * pointer (the page-turn list learned that the hard way).
 */
function LyricRow({
  index,
  t,
  text,
  sounding,
  selected,
  readOnly,
  currentTime,
  onSeek,
  onSelect,
  onText,
  onStamp,
  onNudge,
  onInsertAfter,
  onRemove,
}: {
  index: number
  t: number | undefined
  text: string
  sounding: boolean
  selected: boolean
  readOnly: boolean
  currentTime: number
  onSeek: (t: number) => void
  onSelect: () => void
  onText: (v: string) => void
  onStamp: (at: number) => void
  onNudge: (by: number) => void
  onInsertAfter: () => void
  onRemove: () => void
}) {
  // The time as typed, while the chip is a field. Null when it isn't.
  const [draft, setDraft] = useState<string | null>(null)
  const rest = text === ''
  const editingTime = selected && !readOnly && draft != null

  const commitTime = () => {
    if (draft == null) return
    const parsed = parseTime(draft)
    setDraft(null)
    if (parsed != null && parsed >= 0 && (t == null || Math.abs(parsed - t) > 1e-6)) {
      onStamp(parsed)
      onSeek(parsed)
    }
  }

  return (
    <li
      id={`lyric-${index}`}
      className={`flex h-8 items-center gap-1 rounded-sm pl-1 pr-0.5 transition-colors ${
        sounding
          ? 'bg-rowsel'
          : selected && !readOnly
            ? 'bg-fg/[0.05]'
            : 'hover:bg-fg/[0.04]'
      }`}
    >
      {editingTime ? (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTime}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
          aria-label="Start time, as m:ss.t"
          placeholder="m:ss.t"
          autoFocus
          className="field w-[54px] shrink-0 px-1 py-0.5 text-center font-mono text-[9.5px] tabular-nums"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (selected && !readOnly) {
              // Second click on the selected row's chip: type the time.
              setDraft(t != null ? formatTenths(t) : '')
              return
            }
            onSelect()
            if (t != null) onSeek(t)
          }}
          title={
            t != null
              ? selected && !readOnly
                ? 'Type an exact time'
                : `Play from ${formatTenths(t)}`
              : readOnly
                ? 'Not timed'
                : 'Not timed — select and press the crosshair to stamp it at the playhead'
          }
          // A stamp, not a chip: the words are the sheet and the time is a
          // margin note beside them, small and quiet until it is wanted.
          className={`press w-[44px] shrink-0 text-left font-mono text-[9.5px] tabular-nums text-muted transition-colors hover:text-fg ${
            t == null ? 'opacity-60' : ''
          }`}
        >
          {t != null ? formatTenths(t) : '—'}
        </button>
      )}

      {readOnly ? (
        <span
          className={`min-w-0 flex-1 truncate px-1.5 text-[13px] ${
            rest ? 'italic text-muted' : 'text-fg'
          }`}
        >
          {rest ? '(clears the screen)' : text}
        </span>
      ) : (
        <input
          data-line={index}
          value={text}
          onChange={(e) => onText(e.target.value)}
          onFocus={onSelect}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onInsertAfter()
            } else if (e.key === 'Backspace' && text === '') {
              e.preventDefault()
              onRemove()
            }
          }}
          placeholder="(clears the screen)"
          aria-label={`Line ${index + 1}`}
          spellCheck={false}
          className="field-bare min-w-0 flex-1 px-1.5 py-0.5 text-[13px] text-fg placeholder:italic placeholder:text-muted/60"
        />
      )}

      {selected && !readOnly && (
        <>
          {t != null && (
            <button
              type="button"
              onClick={() => onSeek(t)}
              title="Play from this line"
              aria-label="Play from this line"
              className="btn-icon press h-6 w-5"
            >
              <Play size={11} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onStamp(currentTime)}
            title="Start this line at the playhead"
            aria-label="Start this line at the playhead"
            className="btn-icon press h-6 w-5"
          >
            <Crosshair size={12} />
          </button>
          {t != null && (
            <>
              <button
                type="button"
                onClick={() => onNudge(-0.5)}
                title="Half a second earlier"
                aria-label="Move this line half a second earlier"
                className="btn-icon press h-6 w-5"
              >
                <Minus size={11} />
              </button>
              <button
                type="button"
                onClick={() => onNudge(0.5)}
                title="Half a second later"
                aria-label="Move this line half a second later"
                className="btn-icon press h-6 w-5"
              >
                <Plus size={11} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onRemove}
            title="Delete this line"
            aria-label="Delete this line"
            className="btn-icon press h-6 w-5 text-danger"
          >
            <Trash2 size={11} />
          </button>
        </>
      )}
    </li>
  )
}
