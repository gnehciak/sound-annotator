import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import {
  Play,
  ChevronFirst,
  ChevronLast,
  ChevronDown,
  ChevronRight,
  X,
  Trash2,
} from 'lucide-react'
import type { Annotation } from '../types'
import { noteLabel, formatTime } from '../lib/format'
import { blocksOf, textHtmlOf, asTextData, TEXT_BLOCK } from '../lib/noteBlocks'
import { resolveTag } from '../lib/tags'
import AnnotationEditor from './AnnotationEditor'
import TagPicker from './TagPicker'
import ColorPicker from './ColorPicker'
import type { MentionItem } from './MentionList'

interface Props {
  annotation: Annotation
  color: string
  active: boolean
  isPlaying: boolean
  currentTime: number
  readOnly?: boolean
  onPlay: () => void
  onUpdate: (patch: Partial<Annotation>) => void
  onDelete: () => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
}

export default function AnnotationItem({
  annotation,
  color,
  active,
  isPlaying,
  currentTime,
  readOnly = false,
  onPlay,
  onUpdate,
  onDelete,
  onSeekNote,
  mentionItems,
  uploadImage,
}: Props) {
  // The note's content blocks (migrating legacy notes on the fly). Memoised on
  // the annotation so the text block keeps a stable id across renders.
  const blocks = useMemo(() => blocksOf(annotation), [annotation])
  const textHtml = textHtmlOf(blocks)

  // Edit a text block: update its block and mirror the primary text into
  // `contentHtml` so legacy readers (previews, image cleanup) stay in sync.
  const updateTextBlock = (blockId: string, html: string) => {
    const next = blocks.map((b) =>
      b.id === blockId ? { ...b, data: { html } } : b,
    )
    onUpdate({ blocks: next, contentHtml: textHtmlOf(next) })
  }

  // New (empty) notes start expanded so you can type right away — never in
  // view-only mode, which has no editing controls to reveal.
  const [expanded, setExpanded] = useState(() => !readOnly && !textHtml)
  const tagInfo = resolveTag(annotation.tag)
  const rootRef = useRef<HTMLDivElement>(null)

  // Collapse (hide the editor fields) when the user clicks away from the note.
  useEffect(() => {
    if (!expanded) return
    const onDown = (e: globalThis.MouseEvent) => {
      const target = e.target as HTMLElement
      if (rootRef.current?.contains(target)) return
      if (target.closest('[data-mention-popup]')) return
      setExpanded(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [expanded])

  const isRange = annotation.end != null
  const label = noteLabel(annotation.start, annotation.end)
  // Notes without an end last 3 seconds (for the progress bar + "playing" state).
  const effectiveEnd = annotation.end != null ? annotation.end : annotation.start + 3
  const span = Math.max(0.001, effectiveEnd - annotation.start)
  const progress = Math.min(1, Math.max(0, (currentTime - annotation.start) / span))

  const stop = (e: MouseEvent) => e.stopPropagation()

  // Entrance animation, decided once at mount: only notes that rest at full
  // opacity (active or expanded — a freshly added note mounts expanded) fade in.
  // Dimmed notes carry `opacity-50`, which a fade-in would fight, so they just
  // appear. Captured via an initializer so it can't re-fire when a note later
  // becomes active mid-playback.
  const [enterAnim] = useState(() => active || expanded)

  const handleBodyMouseDown = (e: MouseEvent) => {
    const mention = (e.target as HTMLElement).closest('[data-type="mention"]')
    if (mention) {
      e.preventDefault()
      const id = mention.getAttribute('data-id')
      if (id) onSeekNote(id)
      return
    }
    if (!readOnly && !expanded) setExpanded(true)
  }

  // View-only: clicking anywhere on the note jumps to it. Mentions are handled
  // on mousedown (handleBodyMouseDown), so skip them here to avoid a double seek;
  // the play button stops propagation, so it won't double-fire onPlay either.
  const handleReadOnlyClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-type="mention"]')) return
    onPlay()
  }

  return (
    <div
      ref={rootRef}
      id={`note-${annotation.id}`}
      onClick={readOnly ? handleReadOnlyClick : undefined}
      className={`group relative transition ${
        enterAnim ? 'animate-note-in' : ''
      } ${active ? 'z-20 bg-raised' : 'hover:bg-raised/25'} ${
        readOnly ? 'cursor-pointer' : ''
      } ${isPlaying && !active && !expanded ? 'opacity-50' : ''}`}
    >
      {/* progress bar along the top border */}
      <div
        className="absolute inset-x-0 top-0 z-10 h-[3px]"
        style={{ background: `${color}33` }}
      >
        <div
          className="h-full"
          style={{ width: `${progress * 100}%`, background: color }}
        />
      </div>

      {/* colored note spine — only while playing (the top bar shows colour otherwise) */}
      <div
        className="absolute inset-y-0 left-0 w-[3px] transition-opacity duration-200 ease-instr"
        style={{ background: color, opacity: active ? 1 : 0 }}
      />

      {/* header — click toggles expand (inert in view-only) */}
      <div
        onClick={readOnly ? undefined : () => setExpanded((e) => !e)}
        className={`flex items-center gap-2 pb-1 pl-2 pr-1 pt-2 ${
          readOnly ? '' : 'cursor-pointer'
        }`}
      >
        <button
          type="button"
          // Don't take focus on click: a focused button inside the list gets
          // re-asserted by the browser every time notes reorder, and the native
          // "scroll focused element into view" snaps the panel to the top,
          // fighting the playing-note pin (it lands one row low). Keyboard users
          // can still Tab to it. preventDefault on mousedown blocks the focus
          // without blocking the click.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            stop(e)
            onPlay()
          }}
          title="Jump to this moment and pin it to the top"
          aria-label={`Seek to ${label}`}
          className="press inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink"
          style={{ background: color }}
        >
          <Play size={9} className="fill-current" />
          {label}
        </button>

        {!readOnly && expanded && (
          <ColorPicker color={color} onChange={(c) => onUpdate({ color: c })} />
        )}

        {!readOnly && (expanded || annotation.tag) && (
          <TagPicker tag={annotation.tag} onChange={(tag) => onUpdate({ tag })} />
        )}

        {readOnly && tagInfo && (
          <span
            className="flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            style={{ borderColor: tagInfo.color, color: tagInfo.color }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: tagInfo.color }}
            />
            {tagInfo.label}
          </span>
        )}

        {isRange && (
          <span className="font-mono text-[10px] text-muted" title="How long this section lasts">
            ({formatTime(annotation.end! - annotation.start)} long)
          </span>
        )}

        <div className="flex-1" />

        {active && (
          <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-accent">
            <span className="h-1.5 w-1.5 animate-now-pulse rounded-full bg-accent" />
            playing
          </span>
        )}

        {expanded && (
          <>
            <button
              type="button"
              onClick={(e) => {
                stop(e)
                onUpdate({ start: Math.floor(currentTime) })
              }}
              title="Move this note's start to the current time"
              aria-label="Set start to current time"
              className="px-1 text-muted hover:text-fg"
            >
              <ChevronFirst size={14} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                stop(e)
                onUpdate({
                  end: Math.max(Math.floor(currentTime), annotation.start + 1),
                })
              }}
              title="Set this note's end to the current time (makes it cover a section)"
              aria-label="Set end to current time"
              className="px-1 text-muted hover:text-fg"
            >
              <ChevronLast size={14} />
            </button>
            {isRange && (
              <button
                type="button"
                onClick={(e) => {
                  stop(e)
                  onUpdate({ end: undefined })
                }}
                title="Turn this back into a single moment"
                aria-label="Clear the end and make it a single moment"
                className="px-1 text-muted hover:text-fg"
              >
                <X size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => {
                stop(e)
                onDelete()
              }}
              title="Delete note"
              aria-label="Delete note"
              className="px-1 text-muted hover:text-rose-400"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}

        {!readOnly && (
          <button
            type="button"
            onClick={(e) => {
              stop(e)
              setExpanded((x) => !x)
            }}
            title={expanded ? 'Collapse note' : 'Expand note'}
            aria-label={expanded ? 'Collapse note' : 'Expand note'}
            className="text-muted hover:text-fg"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        )}
      </div>

      {/* body — rendered from the note's content blocks (text only for now;
          window-surfaced plugin blocks land in a later phase) */}
      <div onMouseDown={handleBodyMouseDown} className="pb-1.5 pl-2 pr-1">
        {blocks.map((block) =>
          block.type === TEXT_BLOCK ? (
            <AnnotationEditor
              key={block.id}
              noteId={annotation.id}
              mentionItems={mentionItems}
              uploadImage={uploadImage}
              showToolbar={expanded}
              readOnly={readOnly}
              content={asTextData(block)?.html ?? ''}
              autofocus={expanded && !textHtml}
              onChange={(html) => updateTextBlock(block.id, html)}
            />
          ) : null,
        )}
      </div>
    </div>
  )
}
