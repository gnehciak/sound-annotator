import { useMemo, useState, type MouseEvent } from 'react'
import { Play, ArrowUp, ArrowDown, RotateCw } from 'lucide-react'
import type { Annotation } from '../types'
import { noteLabel } from '../lib/format'
import { blocksOf, asTextData, TEXT_BLOCK } from '../lib/noteBlocks'
import { getPlugin } from '../lib/notePlugins'
import { resolveTag, tagsOf } from '../lib/tags'
import { hueText } from '../lib/noteColors'
import { useResolvedTheme } from '../lib/theme'
import { useSmoothProgress } from '../lib/useSmoothProgress'
import AnnotationEditor from './AnnotationEditor'
import type { MentionItem } from './MentionList'

interface Props {
  annotation: Annotation
  color: string
  active: boolean
  isPlaying: boolean
  currentTime: number
  /** Playback rate, so the progress bar can extrapolate smoothly between ticks. */
  playbackRate?: number
  readOnly?: boolean
  /** Editor mode: this note is the one open in the inspector. */
  selected?: boolean
  /**
   * Editor mode: select this note (opens it in the inspector). `seekToo` is set
   * for a ⌘/Ctrl-click, asking to also cue the playhead to the note.
   */
  onSelect?: (seekToo: boolean) => void
  /** Whether a same-time note sits directly above / below this one. */
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  /** Seek (and pin) to this note's moment — the timecode button. */
  onPlay: () => void
  /**
   * Range notes: play just this passage, pausing at the note's end — the
   * loop-glyph segment fused to the timecode chip. Re-clicking restarts it.
   */
  onPlayPassage?: () => void
  /** This note's passage is armed to stop at its end (lights the segment). */
  passageArmed?: boolean
  /** Scrub to an arbitrary time within the note (clicking the progress bar). */
  onSeek?: (t: number) => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
}

/**
 * A single note as a read-only preview row: its timecode (click to seek), tag,
 * a render of its text, and a one-line summary of each property block. In the
 * editor, clicking the row selects the note — all editing happens in the
 * inspector (NoteInspector). Reorder ▲/▼ stays here since it's a list operation.
 */
export default function AnnotationItem({
  annotation,
  color,
  active,
  isPlaying,
  currentTime,
  playbackRate = 1,
  readOnly = false,
  selected = false,
  onSelect,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onPlay,
  onPlayPassage,
  passageArmed = false,
  onSeek,
  onSeekNote,
  mentionItems,
}: Props) {
  const theme = useResolvedTheme()
  const blocks = useMemo(() => blocksOf(annotation), [annotation])
  const tags = tagsOf(annotation)

  const isRange = annotation.end != null
  const label = noteLabel(annotation.start, annotation.end)
  // Notes without an end last 3 seconds (for the progress bar + "playing" state).
  const effectiveEnd = annotation.end != null ? annotation.end : annotation.start + 3
  const span = Math.max(0.001, effectiveEnd - annotation.start)
  // Smoothed to the frame rate so the bar glides between the player's coarse
  // time ticks (the YouTube poll is only 4×/s) instead of stepping.
  const progress = useSmoothProgress(currentTime, {
    start: annotation.start,
    span,
    playing: isPlaying,
    rate: playbackRate,
  })

  const stop = (e: MouseEvent) => e.stopPropagation()

  // Fade in only notes that rest at full opacity (active/selected); dimmed notes
  // carry opacity-50, which a fade-in would fight, so they just appear.
  const [enterAnim] = useState(() => active || selected)

  // Clicking a @-mention seeks to that note; handle on mousedown so the row's
  // click (select / seek) can skip it and avoid a double action.
  const handleMouseDown = (e: MouseEvent) => {
    const mention = (e.target as HTMLElement).closest('[data-type="mention"]')
    if (!mention) return
    e.preventDefault()
    const id = mention.getAttribute('data-id')
    if (id) onSeekNote(id)
  }
  const handleClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-type="mention"]')) return
    if (readOnly) onPlay()
    else onSelect?.(e.metaKey || e.ctrlKey)
  }

  const focused = active || selected

  return (
    <div
      id={`note-${annotation.id}`}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
      aria-selected={selected || undefined}
      className={`group relative cursor-pointer transition ${
        enterAnim ? 'animate-note-in' : ''
      } ${
        active ? 'z-20 bg-rowsel' : selected ? 'bg-rowsel' : 'hover:bg-rowsel/25'
      } ${isPlaying && !focused ? 'opacity-50' : ''}`}
    >
      {/* progress bar along the top border. For ranges it's a scrubber: clicking
          seeks to that fraction of the note's span. The button is a taller
          transparent grab strip (over the header's top padding) so the thin bar
          isn't a pixel-hunt; the visible bar thickens on hover. */}
      {isRange && onSeek ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            stop(e)
            const r = e.currentTarget.getBoundingClientRect()
            const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
            onSeek(annotation.start + f * span)
          }}
          title="Click to scrub within this note"
          aria-label="Scrub within this note"
          className="group/bar absolute inset-x-0 top-0 z-10 flex h-2 cursor-pointer items-start"
        >
          <span
            className="block h-[3px] w-full transition-[height] group-hover/bar:h-[5px]"
            style={{ background: `${color}33` }}
          >
            <span
              className="block h-full"
              style={{ width: `${progress * 100}%`, background: color }}
            />
          </span>
        </button>
      ) : (
        <div
          className="absolute inset-x-0 top-0 z-10 h-[3px]"
          style={{ background: `${color}33` }}
        >
          <div
            className="h-full"
            style={{ width: `${progress * 100}%`, background: color }}
          />
        </div>
      )}

      {/* colored spine — shown while playing or selected */}
      <div
        className="absolute inset-y-0 left-0 w-[3px] transition-opacity duration-200 ease-instr"
        style={{ background: color, opacity: focused ? 1 : 0 }}
      />

      {/* header */}
      <div className="flex items-center gap-2 pb-1 pl-2 pr-1 pt-2">
        {/* Timecode chip — for ranges, a passage-play segment is fused on. */}
        <span className="inline-flex items-stretch">
          <button
            type="button"
            // Don't take focus on click: a focused button inside the list gets
            // re-asserted on reorder, and the browser's "scroll into view" then
            // fights the playing-note pin. Keyboard users can still Tab to it.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              stop(e)
              onPlay()
            }}
            title="Jump to this moment and pin it to the top"
            aria-label={`Seek to ${label}`}
            className="press inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[11px] font-bold text-onbright"
            style={{ background: color }}
          >
            {active && isPlaying ? (
              <span className="eq" aria-hidden="true">
                <span className="eq-bar" />
                <span className="eq-bar" />
                <span className="eq-bar" />
                <span className="eq-bar" />
              </span>
            ) : (
              <Play size={9} className="fill-current" />
            )}
            {label}
          </button>
          {isRange && onPlayPassage && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                stop(e)
                onPlayPassage()
              }}
              title={
                passageArmed
                  ? 'Playing this passage — click to restart it'
                  : 'Play just this passage — pauses at the end'
              }
              aria-label={`Play ${label} and stop at the end`}
              className="press flex items-center border-l border-onbright/25 px-1.5 text-onbright"
              style={{ background: color }}
            >
              <RotateCw
                size={11}
                strokeWidth={2.75}
                className={
                  passageArmed && isPlaying
                    ? 'animate-[spin_2.4s_linear_infinite]'
                    : ''
                }
              />
            </button>
          )}
        </span>

        {/* Score position — the bar number / rehearsal mark, shown as typed. */}
        {annotation.bar?.trim() && (
          <span
            title="Bar / rehearsal mark"
            className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted"
          >
            {annotation.bar.trim()}
          </span>
        )}

        {/* Reorder arrows — only when another note shares this time. */}
        {!readOnly && (canMoveUp || canMoveDown) && (
          <span className="flex items-center" onClick={stop}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              disabled={!canMoveUp}
              onClick={(e) => {
                stop(e)
                onMoveUp?.()
              }}
              title="Move above the note at the same time"
              aria-label="Move note up"
              className="press px-0.5 text-muted hover:text-fg disabled:opacity-25 disabled:hover:text-muted"
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              disabled={!canMoveDown}
              onClick={(e) => {
                stop(e)
                onMoveDown?.()
              }}
              title="Move below the note at the same time"
              aria-label="Move note down"
              className="press px-0.5 text-muted hover:text-fg disabled:opacity-25 disabled:hover:text-muted"
            >
              <ArrowDown size={13} />
            </button>
          </span>
        )}

        {tags.map((t) => {
          const info = resolveTag(t)!
          return (
            <span
              key={t}
              className="flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{ borderColor: hueText(info.color, theme), color: hueText(info.color, theme) }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: info.color }}
              />
              {info.label}
            </span>
          )
        })}

        <div className="flex-1" />
      </div>

      {/* body preview — text rendered read-only, then a summary line per block */}
      <div className="pb-1.5 pl-2 pr-1">
        {blocks.map((block) => {
          if (block.type === TEXT_BLOCK) {
            const html = asTextData(block)?.html ?? ''
            if (!html) return null
            return (
              <AnnotationEditor
                key={block.id}
                noteId={annotation.id}
                mentionItems={mentionItems}
                showToolbar={false}
                readOnly
                content={html}
                onChange={() => {}}
              />
            )
          }
          const plugin = getPlugin(block.type)
          if (!plugin) return null
          const Summary = plugin.Summary
          const Icon = plugin.icon
          return (
            <div
              key={block.id}
              className="flex items-center gap-2 border-t border-line/60 px-1 py-1.5"
            >
              <Icon size={12} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <Summary data={block.data} />
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
