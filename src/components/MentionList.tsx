import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { resolveTag } from '../lib/tags'
import { hueText } from '../lib/noteColors'
import { useResolvedTheme } from '../lib/theme'
import type { PropertyOption } from '../lib/propertyTags'
import { CUSTOM_HUE } from '../lib/propertyTags'

export interface MentionItem {
  id: string
  label: string
  color: string
  tags?: string[]
  /** plain-text snippet of the note body, to identify it in the list */
  preview?: string
}

/**
 * One row of the "@" menu. The menu serves two insertions from one keystroke:
 * a `property` (or the `custom` free-typed variant) drops an inline property
 * tag into the prose; a `note` drops the older cross-reference mention.
 */
export type SuggestItem =
  | ({ kind: 'property' } & PropertyOption)
  | { kind: 'custom'; key: string; value: string }
  | { kind: 'note'; key: string; note: MentionItem }

interface Props {
  items: SuggestItem[]
  command: (item: SuggestItem) => void
}

export interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/** Heading shown above the first row of each group. */
function groupOf(item: SuggestItem): 'Properties' | 'Notes' {
  return item.kind === 'note' ? 'Notes' : 'Properties'
}

/** The popup list shown while typing "@" in a note. */
const MentionList = forwardRef<MentionListRef, Props>(function MentionList(
  { items, command },
  ref,
) {
  const theme = useResolvedTheme()
  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [items])

  const choose = (i: number) => {
    const item = items[i]
    if (item) command(item)
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
        if (event.key === 'Enter' || event.key === 'Tab') {
          choose(selected)
          return true
        }
        return false
      },
    }),
    [items, selected],
  )

  return (
    <div className="pop max-h-72 w-72 origin-top animate-pop-in overflow-y-auto py-1">
      {items.length === 0 ? (
        <div className="px-3 py-2.5 text-xs text-muted">Nothing to insert</div>
      ) : (
        items.map((item, i) => {
          const active = i === selected
          const rowClass = `flex w-full flex-col gap-0.5 px-3 py-2 text-left text-xs ${
            active ? 'bg-raised text-fg' : 'text-muted'
          }`
          const header =
            i === 0 || groupOf(items[i - 1]) !== groupOf(item) ? (
              <div
                key={`h-${groupOf(item)}`}
                className={`px-3 pb-1 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-muted ${
                  i === 0 ? 'pt-1' : 'mt-1 border-t border-line/60 pt-2'
                }`}
              >
                {groupOf(item)}
              </div>
            ) : null

          const row =
            item.kind === 'note' ? (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(i)
                }}
                className={rowClass}
              >
                <span className="flex w-full items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: item.note.color }}
                  />
                  <span className="font-mono text-fg">@{item.note.label}</span>
                  {item.note.tags && item.note.tags.length > 0 && (
                    <span className="ml-auto flex items-center gap-1.5">
                      {item.note.tags.map((t) => {
                        const info = resolveTag(t)
                        return info ? (
                          <span
                            key={t}
                            className="chip"
                            style={{
                              ['--hue' as string]: info.color,
                              color: hueText(info.color, theme),
                            }}
                          >
                            {info.label}
                          </span>
                        ) : null
                      })}
                    </span>
                  )}
                </span>
                <span className="block truncate pl-4 text-[11px] leading-snug text-muted">
                  {item.note.preview || 'Empty note'}
                </span>
              </button>
            ) : (
              <button
                key={item.key}
                type="button"
                onMouseEnter={() => setSelected(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(i)
                }}
                className={rowClass}
              >
                <span className="flex w-full items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: item.kind === 'property' ? item.color : CUSTOM_HUE,
                    }}
                  />
                  <span className="truncate text-[12.5px] text-fg">{item.value}</span>
                  <span className="ml-auto shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
                    {item.kind === 'property' ? item.category : 'Custom'}
                  </span>
                </span>
                <span className="block truncate pl-4 text-[11px] leading-snug text-muted">
                  {item.kind === 'property'
                    ? item.fieldLabel
                    : 'Insert as a plain tag'}
                </span>
              </button>
            )

          return header ? (
            <div key={item.key}>
              {header}
              {row}
            </div>
          ) : (
            row
          )
        })
      )}
    </div>
  )
})

export default MentionList
