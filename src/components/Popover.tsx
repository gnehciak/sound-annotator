import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePresence } from '../lib/usePresence'

interface Props {
  open: boolean
  /** The element the popover anchors to (positioned just below it). */
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  /** Popover width in px, or 'anchor' to match the trigger. */
  width?: number | 'anchor'
  className?: string
  children: ReactNode
}

/**
 * A popover rendered through a portal to <body>, so it escapes any
 * `overflow:hidden/auto` ancestor (e.g. the scrolling plugin-window body) and is
 * never clipped. Positioned `fixed` against the anchor, reflowing on
 * scroll/resize, and flipping above the anchor when there isn't room below.
 */
export default function Popover({
  open,
  anchorRef,
  onClose,
  width = 'anchor',
  className = '',
  children,
}: Props) {
  const pop = usePresence(open)
  const panelRef = useRef<HTMLDivElement>(null)

  // Position imperatively (no React state → no set-state-in-effect), before
  // paint, and keep it pinned to the anchor as the page scrolls/resizes.
  useLayoutEffect(() => {
    if (!pop.mounted) return
    const place = () => {
      const a = anchorRef.current
      const p = panelRef.current
      if (!a || !p) return
      const r = a.getBoundingClientRect()
      if (width === 'anchor') p.style.width = `${Math.round(r.width)}px`
      // Clamp horizontally into the viewport (8px gutter) so a right-edge
      // anchor's popover doesn't overflow off-screen.
      const left = Math.max(
        8,
        Math.min(Math.round(r.left), window.innerWidth - p.offsetWidth - 8),
      )
      p.style.left = `${left}px`
      const below = window.innerHeight - r.bottom
      if (below < p.offsetHeight + 8 && r.top > below) {
        p.style.top = 'auto'
        p.style.bottom = `${Math.round(window.innerHeight - r.top + 4)}px`
      } else {
        p.style.bottom = 'auto'
        p.style.top = `${Math.round(r.bottom + 4)}px`
      }
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [pop.mounted, anchorRef, width])

  // Close on a pointer-down outside both the panel and its anchor.
  useLayoutEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, anchorRef, onClose])

  if (!pop.mounted) return null

  return createPortal(
    <div
      ref={panelRef}
      style={{ position: 'fixed', ...(typeof width === 'number' ? { width } : null) }}
      className={`z-50 ${pop.closing ? 'animate-pop-out' : 'animate-pop-in'} ${className}`}
    >
      {children}
    </div>,
    document.body,
  )
}
