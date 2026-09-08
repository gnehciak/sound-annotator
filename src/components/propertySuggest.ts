// The editor's squiggle: a faint underline beneath any word in the prose that
// names a concept but hasn't been made a tag. Click it and a card offers the
// tag (AnnotationEditor owns that card, since it needs React and a Popover).
//
// This is the other half of the auto-tagging input rule in propertyTag.ts, and
// the two are deliberately asymmetric. A word that rewrites itself as you type
// has to be unmistakable, so AUTO_TERMS holds ~140 of the vocabulary's 434
// values and will never hold many more. Everything else lands here instead: it
// is *offered*, never applied, so being wrong costs a dotted line rather than a
// mangled sentence — which is what lets this side carry the whole vocabulary.
//
// Decorations rather than marks, because none of this is stored: the underline
// is derived from the text on every keystroke and vanishes the moment the word
// becomes a tag (an atom node is not text, so it stops matching by itself).
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { findTaggable, type TaggableMatch } from '../lib/propertyTags'

/** A vocabulary word found in the document, at document positions. */
export interface SuggestHit extends Omit<TaggableMatch, 'from' | 'to'> {
  from: number
  to: number
}

interface SuggestState {
  hits: SuggestHit[]
  decos: DecorationSet
}

export const propertySuggestKey = new PluginKey<SuggestState>('propertySuggest')

/**
 * Past this much text the scan stops. A note is a paragraph or two; a document
 * this size is a paste of something else, and underlining all of it would be
 * both slow and useless.
 */
const MAX_SCAN = 20_000

function scan(doc: EditorState['doc']): SuggestState {
  const hits: SuggestHit[] = []
  if (doc.content.size <= MAX_SCAN) {
    doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return
      for (const m of findTaggable(node.text)) {
        hits.push({ ...m, from: pos + m.from, to: pos + m.to })
      }
    })
  }
  return {
    hits,
    decos: DecorationSet.create(
      doc,
      hits.map((h) =>
        Decoration.inline(h.from, h.to, {
          class: 'prop-suggest',
          'data-suggest': h.text,
        }),
      ),
    ),
  }
}

/** The hit under a document position, if the click landed on an underline. */
export function suggestAt(state: EditorState, pos: number): SuggestHit | undefined {
  return propertySuggestKey.getState(state)?.hits.find((h) => pos >= h.from && pos <= h.to)
}

export const PropertySuggest = Extension.create({
  name: 'propertySuggest',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin<SuggestState>({
        key: propertySuggestKey,
        state: {
          init: (_, state) => scan(state.doc),
          // Positions are recomputed from scratch rather than mapped through
          // the transaction: an edit anywhere can make or unmake a word.
          apply: (tr, prev) => (tr.docChanged ? scan(tr.doc) : prev),
        },
        props: {
          // Read-only surfaces — the note-row preview, a shared view link with
          // editing off — show the prose as written, with nothing to act on.
          decorations: (state) =>
            editor.isEditable
              ? (propertySuggestKey.getState(state)?.decos ?? DecorationSet.empty)
              : DecorationSet.empty,
        },
      }),
    ]
  },
})
