import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Fullscreen for one element, kept in sync with the browser's own state so
 * Esc / F11 / the OS chrome can't leave our UI claiming the wrong thing.
 *
 * `supported` is false where the API is missing or blocked (iOS Safari on
 * iPhone never exposes it on generic elements) — callers hide the control
 * rather than offering a key that does nothing.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement === ref.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref])

  const supported =
    typeof document !== 'undefined' && document.fullscreenEnabled === true

  const enter = useCallback(async () => {
    const el = ref.current
    if (!el?.requestFullscreen) return
    try {
      await el.requestFullscreen()
    } catch {
      // Denied (no user gesture, or the browser said no) — stay windowed.
    }
  }, [ref])

  const exit = useCallback(async () => {
    if (document.fullscreenElement !== ref.current) return
    try {
      await document.exitFullscreen()
    } catch {
      /* already out */
    }
  }, [ref])

  const toggle = useCallback(() => {
    if (document.fullscreenElement === ref.current) void exit()
    else void enter()
  }, [ref, enter, exit])

  return { isFullscreen, supported, enter, exit, toggle }
}
