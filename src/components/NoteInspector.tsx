import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react'
import { ChevronFirst, ChevronLast, X, Trash2, Plus } from 'lucide-react'
import type { Annotation } from '../types'
import {
  blocksOf,
  textHtmlOf,
  asTextData,
  makeBlock,
  TEXT_BLOCK,
} from '../lib/noteBlocks'
import { getPlugin, addablePlugins } from '../lib/notePlugins'
import AnnotationEditor, { type AnnotationEditorHandle } from './AnnotationEditor'
import TagPicker from './TagPicker'
import ColorPicker from './ColorPicker'
import Popover from './Popover'
import type { MentionItem } from './MentionList'

interface Props {
  annotation: Annotation
  color: string
  currentTime: number
  /** Freshly created: drop the caret into the text editor on open. */
  autoFocus?: boolean
  onFocusHandled?: () => void
  onUpdate: (patch: Partial<Annotation>) => void
  onDelete: () => void
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
  currentTime,
  autoFocus,
  onFocusHandled,
  onUpdate,
  onDelete,
  onSeekNote,
  mentionItems,
  uploadImage,
}: Props) {
  const blocks = useMemo(() => blocksOf(annotation), [annotation])
  const isRange = annotation.end != null
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

  const iconBtn =
    'press rounded p-1 text-muted hover:bg-raised hover:text-fg'

  return (
    <div className="flex flex-col">
      {/* Metadata controls */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line/60 px-3 py-2">
        <ColorPicker color={color} onChange={(c) => onUpdate({ color: c })} />
        <TagPicker tag={annotation.tag} onChange={(tag) => onUpdate({ tag })} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onUpdate({ start: Math.floor(currentTime) })}
          title="Set start to the current time"
          aria-label="Set start to current time"
          className={iconBtn}
        >
          <ChevronFirst size={15} />
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdate({
              end: Math.max(Math.floor(currentTime), annotation.start + 1),
            })
          }
          title="Set end to the current time (makes it cover a section)"
          aria-label="Set end to current time"
          className={iconBtn}
        >
          <ChevronLast size={15} />
        </button>
        {isRange && (
          <button
            type="button"
            onClick={() => onUpdate({ end: undefined })}
            title="Turn this back into a single moment"
            aria-label="Clear the end"
            className={iconBtn}
          >
            <X size={15} />
          </button>
        )}
        <button
          type="button"
          onClick={onDelete}
          title="Delete note"
          aria-label="Delete note"
          className="press rounded p-1 text-muted hover:bg-raised hover:text-rose-400"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Content blocks: text editor inline, then each property plugin's editor */}
      <div onMouseDown={handleBodyMouseDown}>
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
                  className="press rounded p-0.5 text-muted hover:text-rose-400"
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
        className="press inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-accent hover:text-accent"
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
