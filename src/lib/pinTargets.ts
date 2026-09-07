// The boxes a pin can be dropped on, and which one a point is over.
//
// Dragging a pin out of the inspector has to land it on one of two things that
// live in different components and know nothing about each other: the video
// frame (VideoOverlays) and the drawn page of the score (ScoreLayer). Rather
// than thread refs up through App and back down, each registers the element it
// owns here and the drag asks this module what it is over.
//
// Hit-testing is by rectangle, deliberately, not `document.elementFromPoint`:
// both layers are `pointer-events: none` so that neither eats the clicks meant
// for the player, and `elementFromPoint` skips exactly those elements. The
// geometry is the thing being aimed at anyway.
import { useCallback, useEffect, useRef } from 'react'

export type PinTargetKind = 'frame' | 'score'

/** A landed drag: which box, and where in it as 0–1 fractions. */
export interface PinDrop {
  kind: PinTargetKind
  x: number
  y: number
  /** The score page that was on screen. Score drops only. */
  page?: number
}

interface Registration {
  el: HTMLElement
  page: () => number | undefined
}

/**
 * One registration per kind. There is only ever one video frame and one drawn
 * page on screen at a time — the expanded score replaces the in-frame one
 * rather than adding a second — so a map keyed by kind is the whole story, and
 * a later registration replacing an earlier one is the correct behaviour when
 * the layer remounts (into the fullscreen portal, say).
 */
const targets = new Map<PinTargetKind, Registration>()

/** Register `el` as the drop box for `kind`; returns the unregister. */
export function registerPinTarget(
  kind: PinTargetKind,
  el: HTMLElement,
  page: () => number | undefined,
): () => void {
  const registration = { el, page }
  targets.set(kind, registration)
  return () => {
    // Only clear it if nothing else has claimed the kind since — a remount
    // registers the new element before React detaches the old one.
    if (targets.get(kind) === registration) targets.delete(kind)
  }
}

/**
 * What's under the pointer, or null. The score is tested first because its
 * page sits *inside* the frame: over the page, both boxes contain the point,
 * and the page is the more specific answer — which is also what makes "drop it
 * on the music" and "drop it on the picture" one gesture with two outcomes.
 */
export function pinTargetAt(clientX: number, clientY: number): PinDrop | null {
  for (const kind of ['score', 'frame'] as const) {
    const target = targets.get(kind)
    if (!target?.el.isConnected) continue
    const box = target.el.getBoundingClientRect()
    if (box.width < 1 || box.height < 1) continue
    if (
      clientX < box.left ||
      clientX > box.right ||
      clientY < box.top ||
      clientY > box.bottom
    )
      continue
    return {
      kind,
      x: clamp01((clientX - box.left) / box.width),
      y: clamp01((clientY - box.top) / box.height),
      ...(kind === 'score' ? { page: target.page() } : {}),
    }
  }
  return null
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * A ref callback registering whatever element it's given as this kind's drop
 * box. A callback rather than a `useEffect` over a ref object so registration
 * follows the *element*: the score's page box is remounted whenever the layer
 * moves between the frame and the fullscreen portal, which an effect keyed on
 * a stable ref object would never notice.
 */
export function usePinTarget(kind: PinTargetKind, page?: number) {
  // Read at drop time, not at registration time — the score turns its pages
  // without the box ever being re-registered.
  const pageRef = useRef(page)
  useEffect(() => {
    pageRef.current = page
  }, [page])

  const cleanup = useRef<(() => void) | null>(null)
  return useCallback(
    (node: HTMLElement | null) => {
      cleanup.current?.()
      cleanup.current = node
        ? registerPinTarget(kind, node, () => pageRef.current)
        : null
    },
    [kind],
  )
}
