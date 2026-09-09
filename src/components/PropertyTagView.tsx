// The editable face of an inline property tag — the token you see in the
// note's prose. It shows the value alone; the concept it belongs to is the
// tooltip (and, on paper, a print-only suffix). The node itself
// (parse/serialise/drag/auto-tag) lives in propertyTag.ts.
import { useLayoutEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { X } from 'lucide-react'
import { describeField, hueFor, optionsForField } from '../lib/propertyTags'
import { hueText } from '../lib/noteColors'
import { useResolvedTheme } from '../lib/theme'
import Popover from './Popover'

/**
 * The editable chip. `data-drag-handle` on the wrapper makes the whole chip the
 * grab target — a drag moves the tag, a click opens the value menu.
 */
export default function PropertyTagView({
  node,
  updateAttributes,
  getPos,
  editor,
}: NodeViewProps) {
  const theme = useResolvedTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLElement>(null)

  const field = String(node.attrs.field ?? '')
  const value = String(node.attrs.value ?? '')
  // What the sentence says, which may differ from the vocabulary's spelling.
  const text = String(node.attrs.text ?? '') || value
  const { category } = describeField(field)
  const color = hueFor(field, value)
  const options = optionsForField(field)
  const editable = editor.isEditable
  const listRef = useRef<HTMLDivElement>(null)

  // The list is capped and scrolls, so a chip whose word sits far down its
  // field (Duration runs to dozens) would otherwise open showing the top of
  // the alphabet rather than the word you clicked.
  useLayoutEffect(() => {
    if (!open) return
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('[data-active]')
    if (!list || !row) return
    // Set scrollTop rather than calling scrollIntoView: the panel is portaled
    // and `fixed`, and scrollIntoView would walk on up and scroll the page
    // (and the note under it) as well.
    list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2
  }, [open])

  /**
   * Untag: put the word back as plain text rather than deleting it.
   *
   * The chip stands *for* a word in the sentence — it replaced one when it was
   * made — so removing the tag has to give the sentence its word back, or
   * "the texture is thin" quietly becomes "the texture is". Deleting the word
   * is what Backspace over the chip is for.
   */
  const untag = () => {
    const from = getPos()
    if (typeof from !== 'number') return
    editor
      .chain()
      .focus()
      .insertContentAt({ from, to: from + node.nodeSize }, text)
      .run()
  }

  return (
    <NodeViewWrapper
      as="span"
      ref={ref}
      draggable
      data-drag-handle
      data-property-tag=""
      data-field={field}
      data-value={value}
      data-text={text !== value ? text : undefined}
      title={category ? `${category}: ${value}` : value}
      data-category={category || undefined}
      className="prop-tag"
      style={{
        ['--hue' as string]: color,
        color: hueText(color, theme),
        cursor: editable ? 'grab' : 'default',
      }}
      onClick={(e: React.MouseEvent) => {
        if (!editable) return
        e.preventDefault()
        setOpen((o) => !o)
      }}
    >
      {text}
      {editable && (
        <Popover
          open={open}
          anchorRef={ref}
          onClose={() => setOpen(false)}
          width={196}
          // Capped and scrolling: a field is a word list, and Duration's runs
          // past the height of the window. The concept heading and the untag
          // row are the menu's furniture, so they stay put and only the words
          // scroll under them.
          className="flex max-h-[min(20rem,60vh)] origin-top-left flex-col"
        >
          {options.length > 0 && (
            <div className="shrink-0 px-2.5 pb-1 pt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              {category}
            </div>
          )}
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-0.5"
          >
            {options.map((opt) => (
              <button
                key={opt}
                type="button"
                // Popover portals to <body>, but React still bubbles its events
                // up this component tree — straight back into the chip's own
                // onClick, which would re-open the menu we just closed.
                onClick={(e) => {
                  e.stopPropagation()
                  // Picking a different word replaces the sentence's word too —
                  // the old surface form was a spelling of the *old* value.
                  updateAttributes({ value: opt, text: '' })
                  setOpen(false)
                }}
                data-active={opt === value || undefined}
                className={`flex w-full items-center px-2.5 py-1.5 text-left text-[12px] hover:bg-raised hover:text-fg ${
                  opt === value ? 'text-fg' : 'text-muted'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setOpen(false)
              untag()
            }}
            className={`flex w-full shrink-0 items-center gap-1.5 px-2.5 py-2 text-left text-[12px] text-muted hover:bg-raised hover:text-danger ${
              options.length > 0 ? 'border-t border-line/60' : ''
            }`}
          >
            <X size={12} /> Untag, keep the word
          </button>
        </Popover>
      )}
    </NodeViewWrapper>
  )
}
