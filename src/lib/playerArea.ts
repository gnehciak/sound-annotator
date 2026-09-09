import { useCallback, useRef } from 'react'

/**
 * The cap's default, and the height the area is measured against — see below.
 * Must match the fallback the players declare
 * (`var(--player-max-h, 50vh)` in YouTubePlayer / DrivePlayer).
 */
const FALLBACK = '50vh'

/**
 * Drives `--player-max-h` — the 16:9 video's height cap — from the player
 * area's measured height, so the picture fills the room the overview strip
 * leaves instead of sitting at the default 50vh. Shared by the editor (App)
 * and the read-only ShareViewer, both of which mount the area in two places
 * (notes workspace / structure board).
 *
 * Two things the obvious version gets wrong, both of which leave a video stuck
 * small while the panel around it grows:
 *
 * - **The cap must not measure itself.** Below the 660px split the player
 *   column's height *is* its content, so the area's height is the capped video
 *   — measuring it would ratchet the cap down to the current width and never
 *   let it back up. So every measurement is taken with the cap reset to
 *   `FALLBACK`, which is what the area would be without us; the value we last
 *   wrote never feeds back into the next one.
 * - **The remembered height belongs to the node.** The inline property lives
 *   on the element, so a remount (going home and reopening a track, switching
 *   between the two mount points) hands us a fresh node with no cap on it. The
 *   memo is therefore cleared on every attach, or the "unchanged, skip it"
 *   guard would leave the new node on the 50vh default.
 */
export function usePlayerArea() {
  const roRef = useRef<ResizeObserver | null>(null)
  const lastRef = useRef(-1)

  return useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    // A fresh node carries no inline cap, whatever we measured on the old one.
    lastRef.current = -1
    if (!el) return
    const apply = () => {
      el.style.setProperty('--player-max-h', FALLBACK)
      const h = el.clientHeight
      const next = h > 0 ? h : lastRef.current
      lastRef.current = next
      if (next > 0) el.style.setProperty('--player-max-h', `${next}px`)
    }
    apply()
    roRef.current = new ResizeObserver(apply)
    roRef.current.observe(el)
  }, [])
}
