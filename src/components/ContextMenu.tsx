import { useEffect, useLayoutEffect, useRef, type ComponentType } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../lib/usePresence'
import type { MenuPoint } from '../lib/useContextMenu'

export interface ContextMenuItem {
  key: string
  label: string
  icon?: ComponentType<{ size?: number; className?: string }>
  /** Right-aligned detail — a timecode, a value, a shortcut. */
  hint?: string
  /**
   * Shown greyed, with `disabledTitle` saying why, rather than dropped: a menu
   * whose items come and go teaches nothing about what the thing can do.
   */
  disabled?: boolean
  disabledTitle?: string
  danger?: boolean
  /** Draw a hairline above this item (a group break). */
  separated?: boolean
  onSelect: () => void
}

/**
 * A menu opened at a point rather than under a control — the one thing
 * `Popover` can't do, since it measures an anchor element. Same material
 * (`pop` / `pop-row`) and the same portal-to-body reason: it must escape the
 * `overflow` of whatever it was opened over (the notes column scrolls) and
 * never be clipped by it.
 *
 * While it's open it is modal to the keyboard: every keystroke stops at the
 * capture listener, so the app's global hotkeys (Space, N, [ ]) stand down the
 * way they do while the caret is in a note. Arrows walk the items; Enter and
 * Space pick one — activated here rather than left to the button, because the
 * key never reaches it.
 */
export default function ContextMenu({
  point,
  items,
  onClose,
  label = 'Menu',
  width = 216,
}: {
  point: MenuPoint | null
  items: ContextMenuItem[]
  onClose: () => void
  /** Accessible name for the menu. */
  label?: string
  width?: number
}) {
  const open = point != null
  const pres = usePresence(open)
  const panelRef = useRef<HTMLDivElement>(null)

  // Place before paint, flipping to the other side of the cursor when the menu
  // would run off the edge — the corner of the window is exactly where a
  // right-click on the last note in a list lands. Only ever on the way open:
  // the panel is the same element through its exit animation and keeps the
  // position it was given, which is where the click was.
  useLayoutEffect(() => {
    const p = panelRef.current
    if (!p || !point) return
    const pad = 8
    const w = p.offsetWidth
    const h = p.offsetHeight
    const fit = (v: number, size: number, extent: number) =>
      Math.max(pad, v + size + pad > extent ? v - size : v)
    const left = fit(point.x, w, window.innerWidth)
    const top = fit(point.y, h, window.innerHeight)
    p.style.left = `${Math.round(left)}px`
    p.style.top = `${Math.round(top)}px`
    // `pres.mounted` is a dependency, not decoration: the panel only enters the
    // DOM on the render *after* `point` is set (usePresence flips in an
    // effect), so a placement keyed on `point` alone would run once with no
    // panel to place and never again.
  }, [point, pres.mounted])

  // Open the keyboard on the first item, so the menu is usable without a mouse
  // once it's up (a long press, or the keyboard's own Menu key, both land
  // here). `pres.mounted` for the same reason the placement needs it: there is
  // no panel yet on the render that opens one.
  useEffect(() => {
    if (!open) return
    panelRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus()
  }, [open, pres.mounted])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const btns = Array.from(
          panelRef.current?.querySelectorAll<HTMLButtonElement>(
            'button:not(:disabled)',
          ) ?? [],
        )
        if (btns.length) {
          const i = btns.indexOf(document.activeElement as HTMLButtonElement)
          const next =
            e.key === 'ArrowDown'
              ? (i + 1) % btns.length
              : i <= 0
                ? btns.length - 1
                : i - 1
          btns[next].focus()
        }
      } else if (e.key === 'Enter' || e.key === ' ') {
        const el = document.activeElement
        if (panelRef.current?.contains(el)) {
          e.preventDefault()
          ;(el as HTMLElement).click()
        }
      }
      // Everything else is swallowed too: the menu is modal to the keyboard.
      e.stopPropagation()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    // Scrolling out from under a menu pinned to a point strands it over
    // whatever slid into that spot, so a scroll closes it — but the *gesture*,
    // not the `scroll` event. The app scrolls itself smoothly (a clicked note
    // animating to the top of the list), and those events are still arriving
    // when you right-click the next note, which would shut the menu the
    // instant it opened.
    window.addEventListener('wheel', onClose, { capture: true, passive: true })
    window.addEventListener('touchmove', onClose, { capture: true, passive: true })
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose, true)
      window.removeEventListener('touchmove', onClose, true)
    }
  }, [open, onClose])

  if (!pres.mounted) return null

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', width }}
      className={`pop z-50 py-1 ${pres.closing ? 'animate-pop-out' : 'animate-pop-in'}`}
    >
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            title={item.disabled ? item.disabledTitle : undefined}
            onClick={(e) => {
              // Let go of the keyboard *before* acting. The panel outlives the
              // click by its exit animation, and a focused button removed at
              // the end of it drops focus to <body> — which would land after
              // the caret the action just placed (a new note opens with the
              // caret in it) and quietly undo it.
              e.currentTarget.blur()
              onClose()
              item.onSelect()
            }}
            className={`pop-row ${item.separated ? 'mt-1 border-t border-line pt-2' : ''} ${
              item.disabled
                ? 'cursor-default opacity-45 hover:bg-transparent hover:text-muted'
                : item.danger
                  ? 'hover:bg-danger/10 hover:text-danger'
                  : ''
            }`}
          >
            {Icon && <Icon size={13} className="shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted/70">
                {item.hint}
              </span>
            )}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
