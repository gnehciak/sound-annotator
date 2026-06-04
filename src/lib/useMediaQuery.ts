import { useEffect, useState } from 'react'

/**
 * Track a CSS media query. Initial value is read synchronously at mount; the
 * effect only subscribes (no setState in its body), so it stays lint-clean.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
