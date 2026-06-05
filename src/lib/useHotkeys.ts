import { useEffect, useLayoutEffect, useRef } from 'react'

export const isTypingTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  )
}

// A single global keydown listener. Skips keystrokes while the user is typing
// in an input, textarea, or rich-text (contenteditable) field — and any
// Cmd/Ctrl/Alt combo — so shortcuts never hijack note editing or browser keys.
// The handler is read through a ref so callers can pass a fresh closure each
// render without re-subscribing.
export function useHotkeys(handler: (e: KeyboardEvent) => void) {
  const ref = useRef(handler)
  useLayoutEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
