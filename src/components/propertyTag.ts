// The inline property tag: a TipTap atom node that renders as a hued chip
// sitting inside the note's prose. Inserted by typing "@" (see noteMention.ts),
// draggable to anywhere else in the text, and clickable to swap its value.
//
// The node is `atom` + `draggable`, which is what gives it ProseMirror's own
// drag-and-drop: grabbing the chip lifts it out of the paragraph and drops it
// wherever the caret lands, without the surrounding text ever being selected.
// The chip's editable React view lives in PropertyTagView.tsx.
import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { describeField, hueFor, inkFor } from '../lib/propertyTags'
import PropertyTagView from './PropertyTagView'

/**
 * The stored markup, which is also what a read-only render and the PDF export
 * see: `data-property-tag` marks it, `data-field`/`data-value` are the payload
 * (lib/propertyTags.ts reads them back), and the two hue variables carry the
 * colour so the chip looks right outside the app's React tree — `--hue` for
 * fills and borders on either theme, `--hue-ink` for text on white paper,
 * where the raw signal colour would fail AA (the print documents in
 * exportPdf.ts / answerSheet.ts have no React to run hueText for them).
 */
function chipAttrs(field: string, value: string) {
  const { category } = describeField(field)
  const color = hueFor(field, value)
  return {
    'data-property-tag': '',
    'data-field': field,
    'data-value': value,
    class: 'prop-tag',
    style: `--hue: ${color}; --hue-ink: ${inkFor(field, value)}`,
    title: category ? `${category}: ${value}` : value,
  }
}

export const PropertyTag = Node.create({
  name: 'propertyTag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      field: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-field') ?? '',
        renderHTML: () => ({}),
      },
      value: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-value') ?? '',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-property-tag]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const field = String(node.attrs.field ?? '')
    const value = String(node.attrs.value ?? '')
    const { category } = describeField(field)
    return [
      'span',
      mergeAttributes(HTMLAttributes, chipAttrs(field, value)),
      ...(category
        ? [['span', { class: 'prop-tag-cat' }, category] as const]
        : []),
      ['span', { class: 'prop-tag-val' }, value],
    ]
  },

  renderText({ node }) {
    return String(node.attrs.value ?? '')
  },

  addNodeView() {
    return ReactNodeViewRenderer(PropertyTagView)
  },
})
