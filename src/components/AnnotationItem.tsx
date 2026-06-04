import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import {
  Play,
  ChevronFirst,
  ChevronLast,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  X,
  Trash2,
  Plus,
} from 'lucide-react'
import type { Annotation } from '../types'
import { noteLabel, formatTime } from '../lib/format'
import { blocksOf, textHtmlOf, asTextData, makeBlock, TEXT_BLOCK } from '../lib/noteBlocks'
import { getPlugin, addablePlugins } from '../lib/notePlugins'
import { usePresence } from '../lib/usePresence'
import { resolveTag } from '../lib/tags'
import AnnotationEditor, { type AnnotationEditorHandle } from './AnnotationEditor'
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
  /** Freshly created: expand, scroll into view, and focus the editor. */
  autoFocusNew?: boolean
  /** Called once the auto-focus has run, so the parent can clear its target. */
  onFocusHandled?: () => void
  /** Whether a same-time note sits directly above / below this one. */
  canMoveUp?: boolean
  canMoveDown?: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  onPlay: () => void
  onUpdate: (patch: Partial<Annotation>) => void
  onDelete: () => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
  /** Open a (window-surfaced) block's editor. */
  onOpenBlock?: (blockId: string) => void
  /** Which of this note's blocks is currently open in the window, if any. */
  openBlockId?: string
}

export default function AnnotationItem({
  annotation,
  color,
  active,
  isPlaying,
  currentTime,
  readOnly = false,
  autoFocusNew = false,
  onFocusHandled,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  onPlay,
  onUpdate,
  onDelete,
  onSeekNote,
  mentionItems,
  uploadImage,
  onOpenBlock,
  openBlockId,
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

  // Add a window-surfaced property block (e.g. musical elements) and open it.
  const addBlock = (type: string) => {
    const plugin = getPlugin(type)
    if (!plugin) return
    const block = makeBlock(type, plugin.createData())
    onUpdate({ blocks: [...blocks, block] })
    onOpenBlock?.(block.id)
  }

  const removeBlock = (blockId: string) =>
    onUpdate({ blocks: blocks.filter((b) => b.id !== blockId) })

  // New (empty) notes start expanded so you can type right away — never in
  // view-only mode, which has no editing controls to reveal.
  const [expanded, setExpanded] = useState(() => !readOnly && !textHtml)
  const tagInfo = resolveTag(annotation.tag)
  const rootRef = useRef<HTMLDivElement>(null)
  const editorApiRef = useRef<AnnotationEditorHandle | null>(null)

  // Just-created note: bring it into view and drop the caret into its editor so
  // the user can type immediately. (A new empty note already mounts expanded.)
  // Wait a frame so the editor has mounted and the list has settled before
  // scrolling/focusing, then tell the parent it's handled (clearing the
  // one-shot target).
  useEffect(() => {
    if (!autoFocusNew) return
    const raf = requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ block: 'nearest' })
      editorApiRef.current?.focus()
      onFocusHandled?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [autoFocusNew, onFocusHandled])

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

  // Esc "deselects" the note: collapse it and drop the caret out of its editor,
  // so you can return to keyboard transport shortcuts without reaching for the
  // mouse. Handled in the capture phase because ProseMirror always calls
  // preventDefault on Escape (it's a "capture" key), which rules out a
  // defaultPrevented check — and because the @-mention popup tears itself down
  // synchronously on Esc before a bubble handler would see it. In capture we
  // still see the open popup, so we let Esc close it and leave the note put.
  const handleEscapeCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !expanded) return
    if (document.querySelector('[data-mention-popup]')) return
    setExpanded(false)
    const el = document.activeElement as HTMLElement | null
    if (el && rootRef.current?.contains(el)) el.blur()
  }

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
      onKeyDownCapture={readOnly ? undefined : handleEscapeCapture}
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

        {/* Reorder arrows — shown only when another note shares this time, so the
           order is otherwise ambiguous. preventDefault on mousedown keeps focus
           off the button (a focused button in the list fights the scroll pin
           when the reorder re-sorts). */}
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

      {/* body — rendered from the note's content blocks: the text block edits
          inline; other (window-surfaced) blocks show a read-only summary line
          and open their editor window on click. */}
      <div onMouseDown={handleBodyMouseDown} className="pb-1.5 pl-2 pr-1">
        {blocks.map((block) => {
          if (block.type === TEXT_BLOCK) {
            return (
              <AnnotationEditor
                key={block.id}
                ref={editorApiRef}
                noteId={annotation.id}
                mentionItems={mentionItems}
                uploadImage={uploadImage}
                showToolbar={expanded}
                readOnly={readOnly}
                content={asTextData(block)?.html ?? ''}
                autofocus={expanded && !textHtml}
                onChange={(html) => updateTextBlock(block.id, html)}
              />
            )
          }
          const plugin = getPlugin(block.type)
          if (!plugin) return null
          const Summary = plugin.Summary
          const Icon = plugin.icon
          const isOpen = openBlockId === block.id
          return (
            <div
              key={block.id}
              className={`group/blk flex items-center gap-2 border-t border-line/60 px-1 py-1.5 ${
                isOpen ? 'bg-raised' : ''
              }`}
            >
              {readOnly ? (
                <span className="flex min-w-0 flex-1 items-center gap-2 px-1">
                  <Icon size={12} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <Summary data={block.data} />
                  </span>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      stop(e)
                      onOpenBlock?.(block.id)
                    }}
                    title={`Edit ${plugin.label}`}
                    className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left"
                  >
                    <Icon
                      size={12}
                      className={`shrink-0 ${isOpen ? 'text-accent' : 'text-muted'}`}
                    />
                    <span className="min-w-0 flex-1">
                      <Summary data={block.data} />
                    </span>
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      stop(e)
                      removeBlock(block.id)
                    }}
                    title={`Remove ${plugin.label}`}
                    aria-label={`Remove ${plugin.label}`}
                    className="shrink-0 px-1 text-muted opacity-0 hover:text-rose-400 group-hover/blk:opacity-100"
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </div>
          )
        })}

        {!readOnly && expanded && addablePlugins().length > 0 && (
          <AddPropertyMenu onAdd={addBlock} />
        )}
      </div>
    </div>
  )
}

/** "+ Property" menu — lists the addable plugins and adds the chosen block. */
function AddPropertyMenu({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false)
  const pop = usePresence(open)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={ref} className="relative mt-1.5 px-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((o) => !o)}
        className="press inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-accent hover:text-accent"
      >
        <Plus size={12} /> Property
      </button>
      {pop.mounted && (
        <div
          className={`absolute left-1 top-full z-20 mt-1 w-48 origin-top-left rounded border border-line bg-panel py-1 shadow-lg ${
            pop.closing ? 'animate-pop-out' : 'animate-pop-in'
          }`}
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
        </div>
      )}
    </div>
  )
}
