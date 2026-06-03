import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { AlignLeft, AlignCenter, AlignRight, Trash2 } from 'lucide-react'

const MIN_WIDTH = 48
type Align = 'left' | 'center' | 'right'
const ALIGNMENTS: { value: Align; Icon: typeof AlignLeft }[] = [
  { value: 'left', Icon: AlignLeft },
  { value: 'center', Icon: AlignCenter },
  { value: 'right', Icon: AlignRight },
]

/**
 * React node view for {@link ResizableImage}: the image plus a corner drag
 * handle and (when selected) an align toolbar. Until the image has loaded it
 * shows a shimmer skeleton and fades in — so a project full of images doesn't
 * flash empty boxes on first open. Handle/toolbar only render while the editor
 * is editable, so the read-only share viewer shows the saved size and alignment.
 */
export default function ResizableImageView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const { src, alt, title, width, align } = node.attrs as {
    src: string
    alt?: string | null
    title?: string | null
    width?: number | null
    align?: Align | null
  }
  const imgRef = useRef<HTMLImageElement>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const editable = editor.isEditable

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = imgRef.current?.offsetWidth ?? 0
    // Don't let an image grow past the editor's content width.
    const maxWidth = editor.view.dom.clientWidth || startWidth
    const clamp = (w: number) =>
      Math.round(Math.max(MIN_WIDTH, Math.min(w, maxWidth)))

    const onMove = (ev: PointerEvent) =>
      setDragWidth(clamp(startWidth + (ev.clientX - startX)))
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragWidth(null)
      // Commit once, on release — avoids a transaction (and a save) per frame.
      updateAttributes({ width: clamp(startWidth + (ev.clientX - startX)) })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const shown = dragWidth ?? width ?? null
  const widthStyle = shown ? `${shown}px` : undefined

  return (
    <NodeViewWrapper
      className="resizable-image"
      style={{
        // Before load we don't know the image's size, so reserve a box for the
        // skeleton; after load the wrapper hugs the real image again.
        width: loaded ? widthStyle : (widthStyle ?? '320px'),
        minHeight: loaded ? undefined : 140,
        marginLeft: align === 'center' || align === 'right' ? 'auto' : undefined,
        marginRight: align === 'center' ? 'auto' : undefined,
      }}
    >
      <img
        ref={imgRef}
        src={src}
        alt={alt ?? ''}
        title={title ?? undefined}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
        style={{ width: widthStyle, opacity: loaded ? 1 : 0 }}
      />
      {!loaded && <span className="resizable-image__skeleton" aria-hidden />}

      {editable && (
        <div className="resizable-image__align" contentEditable={false}>
          {ALIGNMENTS.map(({ value, Icon }) => {
            const active = (align ?? 'left') === value
            return (
              <button
                key={value}
                type="button"
                aria-label={`Align ${value}`}
                aria-pressed={active}
                data-active={active || undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ align: value })}
              >
                <Icon size={13} />
              </button>
            )
          })}
          <span className="resizable-image__align-sep" aria-hidden />
          <button
            type="button"
            aria-label="Delete image"
            className="resizable-image__align-delete"
            title="Delete image"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => deleteNode()}
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}

      {editable && (
        <span
          className="resize-handle"
          contentEditable={false}
          aria-hidden
          onPointerDown={startResize}
          onDragStart={(e) => e.preventDefault()}
        />
      )}
      {dragWidth != null && (
        <span className="resize-badge" contentEditable={false}>
          {dragWidth}px
        </span>
      )}
    </NodeViewWrapper>
  )
}
