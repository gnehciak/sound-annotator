import { useCallback, useEffect, useState } from 'react'
import { loadTheme, saveTheme, type ThemePref } from './storage'
import { useMediaQuery } from './useMediaQuery'

export type { ThemePref }
export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

// Resolve a preference to a concrete theme. 'system' consults the OS.
export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

// Paint a resolved theme onto <html>. Mirrors the boot script in index.html;
// keeping both in sync is the price of a flash-free first paint.
export function applyTheme(theme: ResolvedTheme): void {
  const el = document.documentElement
  el.dataset.theme = theme
  el.style.colorScheme = theme
}

// System → Light → Dark → System. The order the header button cycles through.
export function nextTheme(pref: ThemePref): ThemePref {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system'
}

/**
 * Theme controller — owns the preference and keeps <html data-theme> in sync.
 * Use exactly once, at the app root. `resolved` is derived during render (so a
 * 'system' preference live-tracks the OS via useMediaQuery); the effect only
 * pushes that to the DOM + storage — an external-system sync, not state.
 */
export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(loadTheme)
  const systemDark = useMediaQuery(DARK_QUERY)
  const resolved: ResolvedTheme =
    pref === 'system' ? (systemDark ? 'dark' : 'light') : pref

  useEffect(() => {
    applyTheme(resolved)
    saveTheme(pref)
  }, [resolved, pref])

  const setPref = useCallback((p: ThemePref) => setPrefState(p), [])
  return { pref, setPref, resolved }
}

/**
 * Read-only subscriber to the resolved theme. For components that paint colors
 * outside CSS (canvas, wavesurfer) and must re-read tokens when the theme
 * flips. Side-effect free: it watches the `data-theme` attribute the controller
 * writes, so any number of components can use it safely.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  )
  useEffect(() => {
    const el = document.documentElement
    // The boot script sets data-theme before mount, so the initializer above is
    // already correct; the observer only needs to catch later flips (the setState
    // lives in the callback, not the effect body).
    const obs = new MutationObserver(() =>
      setTheme(el.dataset.theme === 'light' ? 'light' : 'dark'),
    )
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

// Read a `--token` (space-separated RGB channels) as a paintable `rgb(...)`
// string, optionally with alpha. For canvas/JS color that must match tokens.
export function cssRgb(token: string, alpha = 1): string {
  const channels = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim()
  if (!channels) return alpha < 1 ? 'rgba(0,0,0,0)' : '#000'
  return alpha < 1 ? `rgb(${channels} / ${alpha})` : `rgb(${channels})`
}
