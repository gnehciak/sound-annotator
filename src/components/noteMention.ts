import Mention from '@tiptap/extension-mention'
import { ReactRenderer } from '@tiptap/react'
import MentionList, { type MentionItem, type MentionListRef } from './MentionList'

/**
 * A TipTap Mention extension wired to reference other notes in the project.
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
      items: ({ query }) =>
        getItems(query)
          .filter((i) => i.id !== excludeId)
          .slice(0, 8),
      command: ({ editor, range, props }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id: props.id, label: props.label } },
            { type: 'text', text: ' ' },
          ])
          .run()
      },
      render: () => {
        let component: ReactRenderer<MentionListRef> | null = null
        let popup: HTMLDivElement | null = null

        const place = (clientRect?: (() => DOMRect | null) | null) => {
          if (!popup || !clientRect) return
          const rect = clientRect()
          if (!rect) return
          popup.style.left = `${rect.left}px`
          popup.style.top = `${rect.bottom + 4}px`
        }
        const teardown = () => {
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
            place(props.clientRect)
          },
          onUpdate: (props) => {
            component?.updateProps(props)
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
