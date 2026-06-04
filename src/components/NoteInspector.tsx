import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import {
  X,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Crosshair,
} from 'lucide-react'
import type { Annotation } from '../types'
import { formatTime, parseTime } from '../lib/format'
import {
  blocksOf,
  textHtmlOf,
  asTextData,
  makeBlock,
  TEXT_BLOCK,
} from '../lib/noteBlocks'
import { getPlugin, addablePlugins } from '../lib/notePlugins'
import { tagsOf } from '../lib/tags'
import { useSmoothProgress } from '../lib/useSmoothProgress'
import AnnotationEditor, { type AnnotationEditorHandle } from './AnnotationEditor'
import TagPicker from './TagPicker'
import ColorPicker from './ColorPicker'
import Popover from './Popover'
import type { MentionItem } from './MentionList'

interface Props {
  annotation: Annotation
  color: string
  /** Custom tags already used elsewhere in this project, offered for reuse. */
  projectTags: string[]
  currentTime: number
  /** Track play state + rate, so the range bar smooths between time ticks. */
  isPlaying?: boolean
  playbackRate?: number
  /** Freshly created: drop the caret into the text editor on open. */
  autoFocus?: boolean
  onFocusHandled?: () => void
  onUpdate: (patch: Partial<Annotation>) => void
  onDelete: () => void
  /** Cue the playhead to a time (clicking the range bar). */
  onSeek: (t: number) => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
}

/**
 * The single place a note is edited: its metadata controls (colour, tag, start /
 * end, delete), the rich-text body, and every property block (each plugin's
 * editor rendered inline). Hosted in the plugin window (docked 3rd column or
 * modal); the note row itself is just a preview.
 */
export default function NoteInspector({
  annotation,
  color,
  projectTags,
  currentTime,
  isPlaying = false,
  playbackRate = 1,
  autoFocus,
  onFocusHandled,
  onUpdate,
  onDelete,
  onSeek,
  onSeekNote,
  mentionItems,
  uploadImage,
}: Props) {
  const blocks = useMemo(() => blocksOf(annotation), [annotation])
  const editorApiRef = useRef<AnnotationEditorHandle | null>(null)

  const updateTextBlock = (blockId: string, html: string) => {
    const next = blocks.map((b) =>
      b.id === blockId ? { ...b, data: { html } } : b,
    )
    onUpdate({ blocks: next, contentHtml: textHtmlOf(next) })
  }
  const updateBlockData = (blockId: string, data: unknown) => {
    onUpdate({
      blocks: blocks.map((b) => (b.id === blockId ? { ...b, data } : b)),
    })
  }
  const addBlock = (type: string) => {
    const plugin = getPlugin(type)
    if (!plugin) return
    onUpdate({ blocks: [...blocks, makeBlock(type, plugin.createData())] })
  }
  const removeBlock = (blockId: string) =>
    onUpdate({ blocks: blocks.filter((b) => b.id !== blockId) })

  // Begin/End edits, clamped: start ∈ [0, end-1]; end ≥ start+1.
  const setStart = (t: number) => {
    const max =
      annotation.end != null ? annotation.end - 1 : Number.POSITIVE_INFINITY
    onUpdate({ start: Math.max(0, Math.min(max, Math.round(t))) })
  }
  const setEnd = (t: number) =>
    onUpdate({ end: Math.max(Math.round(t), annotation.start + 1) })
  const clearEnd = () => onUpdate({ end: undefined })

  // Just-created note: focus the text editor so the user can type immediately.
  useEffect(() => {
    if (!autoFocus) return
    const raf = requestAnimationFrame(() => {
      editorApiRef.current?.focus()
      onFocusHandled?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [autoFocus, onFocusHandled])

  // Clicking a @-mention inside the editor seeks to that note.
  const handleBodyMouseDown = (e: MouseEvent) => {
    const mention = (e.target as HTMLElement).closest('[data-type="mention"]')
    if (!mention) return
    e.preventDefault()
    const id = mention.getAttribute('data-id')
    if (id) onSeekNote(id)
  }

  return (
    // Keyed by note id in the host, so this remounts (and fades in) each time a
    // different note is loaded into the inspector.
    <div className="flex animate-fade-in flex-col">
      {/* Metadata controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-3 py-2">
        <ColorPicker color={color} onChange={(c) => onUpdate({ color: c })} />
        <TagPicker
          tags={tagsOf(annotation)}
          projectTags={projectTags}
          onChange={(tags) => onUpdate({ tags })}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={onDelete}
          title="Delete note"
          aria-label="Delete note"
          className="press rounded p-1 text-muted hover:bg-raised hover:text-danger"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Times — a mini range bar; Begin on the left, End on the right. Click an
          end to nudge it ±1s, set it to now, or type an exact time. */}
      <NoteTimeBar
        start={annotation.start}
        end={annotation.end ?? null}
        currentTime={currentTime}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        color={color}
        onSeek={onSeek}
        onSetStart={setStart}
        onSetEnd={setEnd}
        onClearEnd={clearEnd}
      />

      {/* Content blocks: text editor inline, then each property plugin's editor.
          White "page" so pasted (white-bg) screenshots blend; on dark it's = ink. */}
      <div onMouseDown={handleBodyMouseDown} className="min-h-[8rem] bg-note">
        {blocks.map((block) => {
          if (block.type === TEXT_BLOCK) {
            return (
              <AnnotationEditor
                key={block.id}
                ref={editorApiRef}
                noteId={annotation.id}
                mentionItems={mentionItems}
                uploadImage={uploadImage}
                showToolbar
                content={asTextData(block)?.html ?? ''}
                onChange={(html) => updateTextBlock(block.id, html)}
              />
            )
          }
          const plugin = getPlugin(block.type)
          if (!plugin?.Editor) return null
          const Editor = plugin.Editor
          const Icon = plugin.icon
          return (
            <div key={block.id} className="border-t border-line">
              <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                <Icon size={12} className="shrink-0 text-muted" />
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg">
                  {plugin.label}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeBlock(block.id)}
                  title={`Remove ${plugin.label}`}
                  aria-label={`Remove ${plugin.label}`}
                  className="press rounded p-0.5 text-muted hover:text-danger"
                >
                  <X size={13} />
                </button>
              </div>
              <Editor
                data={block.data}
                onChange={(d) => updateBlockData(block.id, d)}
                currentTime={currentTime}
              />
            </div>
          )
        })}

        {addablePlugins().length > 0 && (
          <div className="border-t border-line px-3 py-2">
            <AddPropertyMenu onAdd={addBlock} />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * A compact range bar for the note's span: Begin on the left, End on the right,
 * with a fill tracking the playhead's progress through the note. Clicking an
 * endpoint opens a popover to nudge it ±1s, set it to now, or type an exact time.
 */
function NoteTimeBar({
  start,
  end,
  currentTime,
  isPlaying,
  playbackRate,
  color,
  onSeek,
  onSetStart,
  onSetEnd,
  onClearEnd,
}: {
  start: number
  end: number | null
  currentTime: number
  isPlaying: boolean
  playbackRate: number
  color: string
  onSeek: (t: number) => void
  onSetStart: (t: number) => void
  onSetEnd: (t: number) => void
  onClearEnd: () => void
}) {
  const isRange = end != null
  // Smoothed to the frame rate so the fill glides between the player's coarse
  // time ticks instead of stepping (see useSmoothProgress).
  const progress = useSmoothProgress(currentTime, {
    start,
    span: Math.max(0.001, (end ?? start) - start),
    playing: isPlaying && isRange,
    rate: playbackRate,
  })
  return (
    <div className="flex items-center gap-2 border-b border-line/60 px-3 py-2">
      <TimeEndpoint
        label="Begin"
        time={start}
        currentTime={currentTime}
        onCommit={onSetStart}
        align="left"
      />
      {/* Clickable scrubber — thin like the note-card progress bar, with a taller
          transparent hit area. Clicking seeks to that point within the note. */}
      <button
        type="button"
        title="Click to seek within the note"
        aria-label="Seek within the note"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          onSeek(isRange ? start + f * (end - start) : start)
        }}
        className="group/bar relative flex min-w-0 flex-1 items-center py-2"
      >
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-inset transition-colors group-hover/bar:bg-line-strong">
          {isRange ? (
            <div
              className="h-full rounded-full"
              style={{ width: `${progress * 100}%`, background: color }}
            />
          ) : (
            <div
              className="absolute left-0 top-0 h-full w-1 rounded-full"
              style={{ background: color }}
            />
          )}
        </div>
      </button>
      <TimeEndpoint
        label="End"
        time={end}
        currentTime={currentTime}
        onCommit={onSetEnd}
        onClear={isRange ? onClearEnd : undefined}
        align="right"
      />
    </div>
  )
}

/** A clickable timecode chip → popover: type an exact time, or ‹ −1s · Now · +1s ›. */
function TimeEndpoint({
  label,
  time,
  currentTime,
  onCommit,
  onClear,
  align,
}: {
  label: string
  time: number | null
  currentTime: number
  onCommit: (t: number) => void
  onClear?: () => void
  align: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  // null while not editing → the field shows the live value; a string while typing.
  const [text, setText] = useState<string | null>(null)
  const ref = useRef<HTMLButtonElement>(null)

  const base = time ?? Math.floor(currentTime)
  const display = time != null ? formatTime(time) : '—'
  const inputValue = text ?? (time != null ? formatTime(time) : '')

  const close = () => {
    setText(null)
    setOpen(false)
  }
  const commitText = () => {
    if (text != null) {
      const t = parseTime(text)
      if (t != null) onCommit(t)
    }
    setText(null)
  }

  const nudgeBtn =
    'press flex h-7 w-7 items-center justify-center rounded border border-line text-muted hover:border-accent hover:text-accentink'

  return (
    <div className="relative shrink-0">
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${label} — click to edit`}
        aria-label={`${label} ${display}`}
        className={`press rounded-sm border px-1.5 py-0.5 font-mono text-[12px] tabular-nums text-fg hover:border-accent ${
          open ? 'border-accent' : 'border-line'
        }`}
      >
        {display}
      </button>
      <Popover
        open={open}
        anchorRef={ref}
        onClose={close}
        width={184}
        className={`${
          align === 'right' ? 'origin-top-right' : 'origin-top-left'
        } rounded border border-line bg-panel p-2 shadow-lg`}
      >
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          {label}
        </div>
        <input
          value={inputValue}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setText(time != null ? formatTime(time) : '')}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitText()
            }
          }}
          placeholder="m:ss"
          inputMode="numeric"
          aria-label={`${label} time`}
          className="mb-2 w-full rounded border border-line bg-inset px-2 py-1 text-center font-mono text-[12px] text-fg placeholder:text-muted focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCommit(base - 1)}
            title="Nudge back 1 second"
            aria-label="Nudge back 1 second"
            className={nudgeBtn}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => onCommit(Math.floor(currentTime))}
            title="Set to the current time"
            className="press flex h-7 flex-1 items-center justify-center gap-1 rounded border border-line font-mono text-[10px] uppercase tracking-wider text-muted hover:border-accent hover:text-accentink"
          >
            <Crosshair size={12} /> Now
          </button>
          <button
            type="button"
            onClick={() => onCommit(base + 1)}
            title="Nudge forward 1 second"
            aria-label="Nudge forward 1 second"
            className={nudgeBtn}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={() => {
              onClear()
              close()
            }}
            className="press mt-2 flex w-full items-center justify-center gap-1 rounded border border-line/60 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-danger/60 hover:text-danger"
          >
            <X size={11} /> Remove end
          </button>
        )}
      </Popover>
    </div>
  )
}

/** "+ Property" menu — lists the addable plugins and adds the chosen block. */
function AddPropertyMenu({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="press inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-accent hover:text-accentink"
      >
        <Plus size={12} /> Property
      </button>
      <Popover
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={192}
        className="origin-top-left rounded border border-line bg-panel py-1 shadow-lg"
      >
        {addablePlugins().map((p) => {
          const Icon = p.icon
          return (
            <button
              key={p.type}
              type="button"
              onClick={() => {
                onAdd(p.type)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] text-muted hover:bg-raised hover:text-fg"
            >
              <Icon size={13} className="shrink-0" /> {p.label}
            </button>
          )
        })}
      </Popover>
    </>
  )
}
