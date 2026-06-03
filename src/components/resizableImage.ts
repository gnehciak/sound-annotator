import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ResizableImageView from './ResizableImageView'

/**
 * The stock TipTap image with two additions: a persisted `width` (pixels) and a
 * drag-to-resize handle (see {@link ResizableImageView}). `width` round-trips
 * through the HTML — as the `width` attribute plus an inline style — so a resized
 * image keeps its size on reload and in the read-only share viewer.
 */
export const ResizableImage = Image.extend({
  // Run our keyboard shortcuts (the trailing-line Backspace below) before the
  // core keymap's default Backspace, which would otherwise just select the image.
  priority: 1000,
  // Stock images are draggable; that native drag fights the resize handle's
  // pointer gesture. Drag-to-move isn't needed for note screenshots, so drop it.
  draggable: false,
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null as number | null,
        parseHTML: (el) => {
          const raw = el.getAttribute('width') || (el as HTMLElement).style?.width
          const n = parseInt(raw || '', 10)
          return Number.isFinite(n) ? n : null
        },
        renderHTML: (attrs) =>
          attrs.width
            ? {
                width: attrs.width,
                style: `width: ${attrs.width}px; height: auto;`,
              }
            : {},
      },
      align: {
        default: null as 'left' | 'center' | 'right' | null,
        parseHTML: (el) => el.getAttribute('data-align'),
        renderHTML: (attrs) =>
          attrs.align ? { 'data-align': attrs.align } : {},
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
  addKeyboardShortcuts() {
    return {
      // Let Backspace remove the stray empty paragraph that sits after an image
      // (e.g. the trailing line left when you paste an image at the end of a
      // note). By default Backspace there just selects the image instead of
      // deleting the line, so the empty line feels stuck.
      Backspace: () => {
        const { state } = this.editor
        const { $from, empty } = state.selection
        if (!empty || $from.parentOffset !== 0) return false
        if ($from.parent.type.name !== 'paragraph' || $from.parent.content.size !== 0)
          return false
        const before = $from.before()
        const prev = state.doc.resolve(before).nodeBefore
        if (!prev || prev.type.name !== this.name) return false
        return this.editor
          .chain()
          .deleteRange({ from: before, to: $from.after() })
          .run()
      },
    }
  },
})
