import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

/** How long a touch must rest before it counts as a right-click. */
const LONG_PRESS_MS = 500
/** Movement (px) that turns a long press back into a scroll. */
const PRESS_SLOP = 8

/** Where a context menu was opened, in viewport coordinates. */
export interface MenuPoint {
  x: number
  y: number
}

/**
 * The state behind a context menu: where it was opened, and the handlers that
 * open it. Spread `handlers` onto whatever the menu belongs to, and hand
 * `point` / `close` to <ContextMenu>.
 *
 * Two ways in, because a right-click doesn't exist on a touch screen: the
 * `contextmenu` event, and a long press that stands down the moment the finger
 * travels — these surfaces are scrollers, and every flick would otherwise fire
 * it.
 */
export function useContextMenu() {
  const [point, setPoint] = useState<MenuPoint | null>(null)
  const press = useRef<{ timer: number; x: number; y: number } | null>(null)

  const clearPress = useCallback(() => {
    if (!press.current) return
    window.clearTimeout(press.current.timer)
    press.current = null
  }, [])
  useEffect(() => clearPress, [clearPress])

  const close = useCallback(() => setPoint(null), [])
  /**
   * Open at a point directly. For surfaces that must decide *whether* this
   * click has a menu at all before taking the event — the score, where only a
   * right-click actually over a page has anything to offer and the ground
   * around it should keep the browser's own menu.
   */
  const openAt = useCallback((x: number, y: number) => setPoint({ x, y }), [])

  const handlers = {
    onContextMenu: (e: ReactMouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      clearPress()
      setPoint({ x: e.clientX, y: e.clientY })
    },
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType !== 'touch') return
      clearPress()
      const x = e.clientX
      const y = e.clientY
      const timer = window.setTimeout(() => {
        press.current = null
        setPoint({ x, y })
      }, LONG_PRESS_MS)
      press.current = { timer, x, y }
    },
    onPointerMove: (e: ReactPointerEvent) => {
      const p = press.current
      if (!p) return
      if (
        Math.abs(e.clientX - p.x) > PRESS_SLOP ||
        Math.abs(e.clientY - p.y) > PRESS_SLOP
      ) {
        clearPress()
      }
    },
    onPointerUp: clearPress,
    onPointerCancel: clearPress,
  }

  return { point, close, openAt, handlers }
}
