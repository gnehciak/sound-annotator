/**
 * Run a drag gesture on window-level listeners (the pointer leaves the lane
 * constantly at timeline scale). Freezes the cursor + text selection for the
 * gesture's lifetime; each closure reads fresh state through refs. Returns a
 * `cancel` that tears the gesture down *without* firing onUp — the escape
 * hatch a starting pinch uses to abort a half-formed drag.
 *
 * Shared by the section lane and the chord lane, which run their gestures
 * through one `beginDrag` so a pinch can cancel whichever is in flight.
 */
export function windowDrag(
  onMove: (ev: PointerEvent) => void,
  onUp?: (ev: PointerEvent) => void,
  cursor?: string,
): () => void {
  const move = (ev: PointerEvent) => onMove(ev)
  let done = false
  const cleanup = () => {
    if (done) return
    done = true
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  const up = (ev: PointerEvent) => {
    cleanup()
    onUp?.(ev)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  if (cursor) document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
  return cleanup
}

export type BeginDrag = (
  onMove: (ev: PointerEvent) => void,
  onUp?: (ev: PointerEvent) => void,
  cursor?: string,
) => void

export const clamp = (x: number, lo: number, hi: number) =>
  Math.min(Math.max(x, lo), hi)

/** #rrggbb + alpha → #rrggbbaa (lane hues are always 6-digit hex). */
export const hexA = (hex: string, a: number) =>
  `${hex}${Math.round(clamp(a, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')}`
