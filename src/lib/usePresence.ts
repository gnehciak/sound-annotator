import { useEffect, useState } from 'react'

/**
 * Keeps a component mounted long enough to play an exit animation after its
 * `open` flag flips to false. Returns `mounted` (render it at all?) and
 * `closing` (true during the exit window, so you can swap in an -out class).
 *
 *   const { mounted, closing } = usePresence(open)
 *   return mounted && <div className={closing ? 'animate-pop-out' : 'animate-pop-in'} />
 *
 * Re-opening within the exit window cancels the pending unmount (the effect
 * cleanup clears the timer), so a fast close→open just snaps back to open.
 */
export function usePresence(open: boolean, exitMs = 150) {
  const [state, setState] = useState<'closed' | 'open' | 'closing'>(
    open ? 'open' : 'closed',
  )

  useEffect(() => {
    if (open) {
      setState('open')
      return
    }
    // open === false: if we were showing, run the exit then unmount.
    setState((s) => (s === 'closed' ? 'closed' : 'closing'))
    const t = setTimeout(() => setState('closed'), exitMs)
    return () => clearTimeout(t)
  }, [open, exitMs])

  return { mounted: state !== 'closed', closing: state === 'closing' }
}

/** True when the OS/user asked for reduced motion. Read at call time. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  )
}
