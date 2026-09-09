// The inline property tag: a TipTap atom node that renders as a hued token
// sitting inside the note's prose — the word alone, coloured by its concept,
// with the concept itself on hover.
//
// A chip carries two strings, and the distinction matters: `value` is the
// vocabulary's own spelling and is the *data* (it is what search, the exports
// and any future filter read), while `text` is the surface form as it was
// actually written in the sentence. Typing "the texture is monophonic" must
// not leave a capital M sitting mid-sentence, so the chip shows what you
// wrote and files it under what it means. Two ways in: the "@" menu (noteMention.ts),
// and typing an unmistakable term like "monophonic" or "legato" in ordinary
// prose, which tags itself the moment the word ends (see the input rule below).
// Draggable to anywhere else in the text, and clickable to swap its value.
//
// The node is `atom` + `draggable`, which is what gives it ProseMirror's own
// drag-and-drop: grabbing the chip lifts it out of the paragraph and drops it
// wherever the caret lands, without the surrounding text ever being selected.
// The chip's editable React view lives in PropertyTagView.tsx.
import { InputRule, Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { autoTagFor, describeField, hueFor, inkFor } from '../lib/propertyTags'
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
function chipAttrs(field: string, value: string, text: string) {
  const { category } = describeField(field)
  const color = hueFor(field, value)
  return {
    'data-property-tag': '',
    'data-field': field,
    'data-value': value,
    // Only when the sentence spells it differently — an absent data-text means
    // "the value is the spelling", which is every chip written before this.
    ...(text && text !== value ? { 'data-text': text } : null),
    // The concept is the tooltip on screen. On paper there is no hover, so the
    // print stylesheet reads it back out of here — see PROPERTY_TAG_PRINT_CSS.
    'data-category': category,
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
      /** The surface form in this sentence; empty means "same as value". */
      text: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-text') ?? '',
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
    const text = String(node.attrs.text ?? '')
    return [
      'span',
      mergeAttributes(HTMLAttributes, chipAttrs(field, value, text)),
      text || value,
    ]
  },

  // Plain-text serialisation is the prose, so it takes the surface form —
  // copying a note out must not silently recapitalise its sentences.
  renderText({ node }) {
    return String(node.attrs.text || node.attrs.value || '')
  },

  addNodeView() {
    return ReactNodeViewRenderer(PropertyTagView)
  },

  addInputRules() {
    return [
      new InputRule({
        // The word just finished, plus the character that finished it. The
        // lookbehind (rather than a captured prefix) is what makes a term
        // directly after a chip work: ProseMirror renders the atom into the
        // matched text as a "%leaf%" placeholder, and any non-letter counts as
        // a boundary. Newline is deliberately not a terminator — the rule
        // consumes the character it fires on, and re-inserting a newline is
        // not the same as letting Enter split the block.
        find: /(?<![\p{L}\p{M}'’-])([\p{L}][\p{L}\p{M}'’-]*)([\s.,;:!?)\]}"'”’])$/u,
        handler: ({ range, match, chain }) => {
          const hit = autoTagFor(match[1])
          // Dispatching no steps means the rule did not apply and the text
          // stands — the common case, since most words are just words.
          if (!hit) return null
          // ProseMirror suppresses the character that triggered a rule, so the
          // terminator has to go back in behind the tag or it is eaten.
          chain()
            .insertContentAt({ from: range.from, to: range.to }, [
              {
                type: 'propertyTag',
                // match[1] is the word as typed — the chip keeps that spelling.
                attrs: { field: hit.field, value: hit.value, text: match[1] },
              },
              { type: 'text', text: match[2] },
            ])
            .run()
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      // Backspace straight after an auto-tag puts the plain word back, the way
      // it undoes any other input rule. Returns false when there is nothing to
      // undo, so ordinary Backspace is untouched.
      Backspace: () => this.editor.commands.undoInputRule(),
    }
  },
})
