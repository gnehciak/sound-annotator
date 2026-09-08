import Mention from '@tiptap/extension-mention'
import { ReactRenderer } from '@tiptap/react'
import { searchProperties } from '../lib/propertyTags'
import MentionList, {
  type MentionItem,
  type MentionListRef,
  type SuggestItem,
} from './MentionList'

/** Past this many words the "@" is prose, not a query — stop matching. */
const MAX_QUERY_WORDS = 4

/**
 * The "@" menu, wired to TipTap's Mention suggestion plugin but serving two
 * insertions: an **inline property tag** (the concept vocabulary — "@timbre
 * bright", "@legato", "@ff") and, below it, the older **note
 * cross-reference**. Properties lead and notes follow; nothing needs a
 * different trigger key.
 *
 * The query keeps matching across spaces (`allowSpaces`), which is what lets
 * "@timbre bright" narrow the way an editor's completion list does — see
 * searchProperties. The cost is that the plugin would otherwise match "@" plus
 * the whole rest of the paragraph, so two things bound it: a word cap here,
 * and a menu that hides itself rather than sitting empty over the prose.
 *
 * `getItems` returns the current note list; `excludeId` is the editing note.
 */
export function createMention(
  getItems: (query: string) => MentionItem[],
  excludeId: string,
) {
  return Mention.configure({
    HTMLAttributes: { class: 'note-mention' },
    suggestion: {
      char: '@',
      allowSpaces: true,
      items: ({ query }): SuggestItem[] => {
        const q = query.trim().replace(/\s+/g, ' ')
        if (q.split(' ').length > MAX_QUERY_WORDS) return []
        const props: SuggestItem[] = searchProperties(q, 9).map((p) => ({
          kind: 'property' as const,
          ...p,
        }))
        // No vocabulary hit for a single word they typed — offer it verbatim,
        // so an inline tag is never a dead end just because our list is
        // finite. Only for one word: "@the strings enter" is prose.
        if (q && !q.includes(' ') && props.length === 0) {
          props.push({ kind: 'custom', key: `custom:${q}`, value: q })
        }
        const notes: SuggestItem[] = getItems(q)
          .filter((i) => i.id !== excludeId)
          .slice(0, 4)
          .map((note) => ({ kind: 'note' as const, key: `note:${note.id}`, note }))
        return [...props, ...notes]
      },
      command: ({ editor, range, props }) => {
        const item = props as unknown as SuggestItem
        const node =
          item.kind === 'note'
            ? {
                type: 'mention',
                attrs: { id: item.note.id, label: item.note.label },
              }
            : {
                type: 'propertyTag',
                attrs: {
                  field: item.kind === 'property' ? item.field : '',
                  value: item.value,
                },
              }
        editor
          .chain()
          .focus()
          .insertContentAt(range, [node, { type: 'text', text: ' ' }])
          .run()
      },
      render: () => {
        let component: ReactRenderer<MentionListRef> | null = null
        let popup: HTMLDivElement | null = null

        // Pinned under the caret, but clamped into the viewport (8px gutter)
        // the way Popover does — the menu is wide enough that a caret in the
        // right-hand inspector would otherwise push it off-screen — and
        // flipped above the line when there isn't room below.
        // An empty menu is hidden, not torn down: with allowSpaces the query
        // passes through plenty of non-matching prose on its way to a hit.
        const show = (items: readonly unknown[]) => {
          if (popup) popup.style.display = items.length ? '' : 'none'
        }
        const place = (clientRect?: (() => DOMRect | null) | null) => {
          if (!popup || !clientRect) return
          const rect = clientRect()
          if (!rect) return
          const w = popup.offsetWidth
          const h = popup.offsetHeight
          popup.style.left = `${Math.max(
            8,
            Math.min(Math.round(rect.left), window.innerWidth - w - 8),
          )}px`
          const below = window.innerHeight - rect.bottom
          if (below < h + 8 && rect.top > below) {
            popup.style.top = `${Math.max(8, Math.round(rect.top - h - 4))}px`
          } else {
            popup.style.top = `${Math.round(rect.bottom + 4)}px`
          }
        }
        // Dismiss when the user clicks/taps anywhere outside the popup.
        const onPointerDown = (event: PointerEvent) => {
          const target = event.target as Node | null
          if (popup && target && !popup.contains(target)) teardown()
        }
        const teardown = () => {
          document.removeEventListener('pointerdown', onPointerDown, true)
          popup?.remove()
          component?.destroy()
          popup = null
          component = null
        }

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              props,
              editor: props.editor,
            })
            if (!props.clientRect) return
            popup = document.createElement('div')
            popup.style.position = 'fixed'
            popup.style.zIndex = '60'
            // marker so a note doesn't collapse when you click a suggestion
            popup.setAttribute('data-mention-popup', '')
            document.body.appendChild(popup)
            popup.appendChild(component.element)
            show(props.items)
            place(props.clientRect)
            document.addEventListener('pointerdown', onPointerDown, true)
          },
          onUpdate: (props) => {
            component?.updateProps(props)
            show(props.items)
            place(props.clientRect)
          },
          onKeyDown: (props) => {
            if (props.event.key === 'Escape') {
              teardown()
              return true
            }
            return component?.ref?.onKeyDown(props) ?? false
          },
          onExit: teardown,
        }
      },
    },
  })
}
