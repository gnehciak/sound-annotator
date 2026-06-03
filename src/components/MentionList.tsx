import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { resolveTag } from '../lib/tags'

export interface MentionItem {
  id: string
  label: string
  color: string
  tag?: string
}

interface Props {
  items: MentionItem[]
  command: (item: { id: string; label: string }) => void
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/** The popup list shown while typing "@" to mention another note. */
const MentionList = forwardRef<MentionListRef, Props>(function MentionList(
  { items, command },
  ref,
) {
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [items])

  const choose = (i: number) => {
    const item = items[i]
    if (item) command({ id: item.id, label: item.label })
  }

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (!items.length) return false
        if (event.key === 'ArrowUp') {
          setSelected((s) => (s + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setSelected((s) => (s + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          choose(selected)
          return true
        }
        return false
      },
    }),
    [items, selected],
  )

  return (
    <div className="max-h-56 w-56 origin-top animate-pop-in overflow-y-auto rounded border border-line bg-panel py-1 shadow-lg">
      {items.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted">No notes to mention</div>
      ) : (
        items.map((item, i) => {
          const tag = resolveTag(item.tag)
          return (
            <button
              key={item.id}
              type="button"
              onMouseEnter={() => setSelected(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                choose(i)
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${
                i === selected ? 'bg-raised text-fg' : 'text-muted'
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: item.color }}
              />
              <span className="font-mono text-fg">@{item.label}</span>
              {tag && (
                <span
                  className="ml-auto font-mono text-[10px] uppercase tracking-wider"
                  style={{ color: tag.color }}
                >
                  {tag.label}
                </span>
              )}
            </button>
          )
        })
      )}
    </div>
  )
})

export default MentionList
