import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { Annotation } from '../types'
import AnnotationItem from './AnnotationItem'
import { colorForId } from '../lib/noteColors'
import { prefersReducedMotion } from '../lib/usePresence'
import type { MentionItem } from './MentionList'

interface Props {
  annotations: Annotation[]
  currentTime: number
  isPlaying: boolean
  readOnly?: boolean
  scrollRef: RefObject<HTMLDivElement | null>
  /** When paused, sort by timeline (start) order rather than playhead order. */
  resetOnPause?: boolean
  /** A just-created note to focus + scroll into view, or null. */
  focusNoteId?: string | null
  /** Called once the focus note has been handled, so the parent can clear it. */
  onFocusHandled?: () => void
  onSeek: (t: number) => void
  onPlay: () => void
  onUpdate: (id: string, patch: Partial<Annotation>) => void
  onDelete: (id: string) => void
  /** Persist a new top-to-bottom order for a group of same-time notes. */
  onReorder: (orderedIds: string[]) => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
  /** Open a block's editor window (noteId + blockId). */
  onOpenBlock?: (noteId: string, blockId: string) => void
  /** Which block is currently open in the window, if any. */
  openWindow?: { noteId: string; blockId: string } | null
}

const endOf = (a: Annotation) => (a.end != null ? a.end : a.start + 3)

export default function AnnotationList({
  annotations,
  currentTime,
  isPlaying,
  readOnly = false,
  scrollRef,
  resetOnPause = false,
  focusNoteId,
  onFocusHandled,
  onSeek,
  onPlay,
  onUpdate,
  onDelete,
  onReorder,
  onSeekNote,
  mentionItems,
  uploadImage,
  onOpenBlock,
  openWindow,
}: Props) {
  const activeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const a of annotations) {
      if (currentTime >= a.start && currentTime <= endOf(a)) ids.add(a.id)
    }
    return ids
  }, [annotations, currentTime])

  // finished (0) on top, then playing (1), then upcoming (2).
  const rank = (a: Annotation) => {
    if (currentTime > endOf(a)) return 0
    if (currentTime >= a.start) return 1
    return 2
  }

  // Tiebreaker for notes that land in the same slot (same time, same rank):
  // a manually set `order` wins; reordered notes (which all carry `order`) sit
  // above never-touched ones, which keep their original creation order.
  const tie = (a: Annotation, b: Annotation) => {
    if (a.order != null && b.order != null) return a.order - b.order
    if (a.order != null) return -1
    if (b.order != null) return 1
    return a.createdAt - b.createdAt
  }

  // Paused with "reset on pause" on: drop the playhead-relative grouping and
  // show the notes in plain timeline order, which is steadier to read/edit.
  const chronological = !isPlaying && resetOnPause

  const sorted = useMemo(() => {
    return [...annotations].sort((a, b) => {
      if (chronological) return a.start - b.start || tie(a, b)
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (ra === 0) return endOf(a) - endOf(b) || a.start - b.start || tie(a, b)
      return a.start - b.start || tie(a, b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, currentTime, chronological])

  const primaryActiveId = sorted.find((a) => activeIds.has(a.id))?.id ?? null
  const orderSig = sorted.map((a) => a.id).join('|')

  const prevTops = useRef<Map<string, number>>(new Map())
  const prevSig = useRef('')
  const prevPrimary = useRef<string | null>(null)
  // The scrollTop the auto-scroll logic last *intended*. The pin trusts this
  // rather than the live scrollTop, because the browser sometimes mutates the
  // live value out from under us during a reorder commit (e.g. scrolling a
  // focused control into view) — reading it back would make the pin compute
  // from a clobbered baseline and the playing note would jump. null means "no
  // intent yet / defer to the live value" (initial mount, or after the user
  // scrolls). Kept in sync by followToTop and reset on user scroll.
  const pinnedScroll = useRef<number | null>(null)
  const userScrolling = useRef(false)
  const returnTimer = useRef<number | null>(null)
  const followRaf = useRef<number | null>(null)
  const primaryRef = useRef<string | null>(null)
  primaryRef.current = primaryActiveId
  // Read inside long-lived closures (scroll listener) without re-binding them.
  const playingRef = useRef(false)
  playingRef.current = isPlaying

  const cancelFollow = () => {
    if (followRaf.current != null) {
      cancelAnimationFrame(followRaf.current)
      followRaf.current = null
    }
  }

  // Smoothly glide the *current* playing note to the top. We re-read the live
  // primary (primaryRef) and its position every frame, so the glide always
  // tracks whatever is playing now — never a note captured at trigger time that
  // has since finished and drifted to the top of the list (which would drag the
  // scroll to the very top and fight the reorder pin).
  const liveTargetEl = () => {
    const id = primaryRef.current
    return id ? document.getElementById(`note-${id}`) : null
  }
  const followToTop = () => {
    cancelFollow()
    const sc = scrollRef.current
    if (!sc) return
    // Reduced motion: jump straight to the target, no glide.
    if (prefersReducedMotion()) {
      const el = liveTargetEl()
      if (el) sc.scrollTop = Math.max(0, el.offsetTop)
      pinnedScroll.current = sc.scrollTop
      return
    }
    const step = () => {
      const scr = scrollRef.current
      const el = liveTargetEl()
      if (!scr || !el) {
        followRaf.current = null
        return
      }
      const target = Math.max(0, el.offsetTop)
      const diff = target - scr.scrollTop
      if (Math.abs(diff) < 0.5) {
        scr.scrollTop = target
        pinnedScroll.current = scr.scrollTop
        followRaf.current = null
        return
      }
      scr.scrollTop += diff * 0.22
      pinnedScroll.current = scr.scrollTop
      followRaf.current = requestAnimationFrame(step)
    }
    followRaf.current = requestAnimationFrame(step)
  }

  // Apple-Music style: let the user scroll freely, then glide the playing note
  // back to the top after 3s of no scrolling. While paused (e.g. editing a note)
  // we never auto-return — the list stays exactly where the user left it.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onUserScroll = () => {
      userScrolling.current = true
      pinnedScroll.current = null // defer to the user's scroll position
      cancelFollow()
      if (returnTimer.current) clearTimeout(returnTimer.current)
      returnTimer.current = window.setTimeout(() => {
        userScrolling.current = false
        if (playingRef.current) followToTop()
      }, 3000)
    }
    el.addEventListener('wheel', onUserScroll, { passive: true })
    el.addEventListener('touchmove', onUserScroll, { passive: true })
    return () => {
      el.removeEventListener('wheel', onUserScroll)
      el.removeEventListener('touchmove', onUserScroll)
      if (returnTimer.current) clearTimeout(returnTimer.current)
      cancelFollow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRef])

  // FLIP: animate the list when notes reorder.
  useLayoutEffect(() => {
    if (orderSig === prevSig.current && primaryActiveId === prevPrimary.current) {
      return
    }
    const ids = sorted.map((a) => a.id)
    const newTops = new Map<string, number>()
    for (const id of ids) {
      const el = document.getElementById(`note-${id}`)
      if (el) newTops.set(id, el.offsetTop)
    }

    const activeChanged = primaryActiveId !== prevPrimary.current
    const scroller = scrollRef.current

    // Keep the still-playing note visually fixed when notes reorder around it.
    // This also runs during a follow-scroll: the pin preserves the note's
    // current position through the reorder, and the follow keeps easing it to
    // the top — without it the note jumps down and slides back up. The shift is
    // folded into the FLIP offset so notes whose layout didn't change don't
    // teleport.
    let pinShift = 0
    if (!activeChanged && primaryActiveId && scroller) {
      const oldA = prevTops.current.get(primaryActiveId)
      const newA = newTops.get(primaryActiveId)
      if (oldA != null && newA != null && oldA !== newA) {
        pinShift = newA - oldA
        // Pin relative to the scroll we last *intended*, not the live value
        // (the browser may have clobbered it during this commit). base + pinShift
        // keeps the playing note at the same on-screen spot; the FLIP offsets
        // below use the same pinShift, so they stay consistent.
        const base = pinnedScroll.current ?? scroller.scrollTop
        scroller.scrollTop = base + pinShift
        pinnedScroll.current = scroller.scrollTop
      }
    }

    // Slide every other note from its old viewport position to its new one.
    for (const id of ids) {
      if (id === primaryActiveId) continue
      const el = document.getElementById(`note-${id}`)
      const old = prevTops.current.get(id)
      const neu = newTops.get(id)
      if (!el || old == null || neu == null) continue
      const dy = old - neu + pinShift
      if (dy === 0) continue
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
      void el.offsetHeight // force reflow so the next change animates
      el.style.transition =
        'transform 340ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease'
      el.style.transform = ''
    }

    // When the playing note itself changes, our previous scroll intent no longer
    // applies to the new note — re-sync to the live value (followToTop will then
    // glide it to the top and keep pinnedScroll updated).
    if (activeChanged) pinnedScroll.current = null

    // Bring the new playing note to the top (unless the user is scrolling around,
    // or playback is paused — while paused the user is editing and the list
    // shouldn't jump on its own).
    if (activeChanged && primaryActiveId && !userScrolling.current && isPlaying) {
      followToTop()
    }

    prevTops.current = newTops
    prevSig.current = orderSig
    prevPrimary.current = primaryActiveId
  })

  // Clicking a note's play button: seek there, start playback, then pin the
  // *first* playing note to the top. A longer note that started earlier keeps
  // the top spot.
  const playNote = (start: number) => {
    userScrolling.current = false
    if (returnTimer.current) clearTimeout(returnTimer.current)
    onSeek(start)
    onPlay()
    requestAnimationFrame(() => followToTop())
  }

  // Two notes occupy the same slot when only the manual `order` tiebreaker
  // separates them, so the ▲/▼ controls can swap them and the swap will stick.
  // In timeline order that's just a shared start; otherwise the playhead rank
  // (and, for finished notes, the end) must match too.
  const sameSlot = (a: Annotation, b: Annotation) =>
    chronological
      ? a.start === b.start
      : rank(a) === rank(b) &&
        a.start === b.start &&
        (rank(a) !== 0 || endOf(a) === endOf(b))

  // Move a note one step within its run of same-slot neighbours, then persist
  // the run's new order. No-op if the adjacent note is in a different slot.
  const moveNote = (id: string, dir: -1 | 1) => {
    const i = sorted.findIndex((a) => a.id === id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= sorted.length || !sameSlot(sorted[i], sorted[j])) return
    let lo = i
    let hi = i
    while (lo > 0 && sameSlot(sorted[lo - 1], sorted[lo])) lo--
    while (hi < sorted.length - 1 && sameSlot(sorted[hi], sorted[hi + 1])) hi++
    const run = sorted.slice(lo, hi + 1).map((a) => a.id)
    const pi = i - lo
    const pj = j - lo
    ;[run[pi], run[pj]] = [run[pj], run[pi]]
    onReorder(run)
  }

  if (sorted.length === 0) {
    return (
      <div className="m-3 border border-dashed border-line p-8 text-center text-sm text-muted">
        {readOnly ? (
          'No notes on this track.'
        ) : (
          <>
            No notes yet. Press play, then click{' '}
            <span className="font-mono text-accent">Add note</span> to mark a
            moment, or use{' '}
            <span className="font-mono text-accent">Mark start / Mark end</span>{' '}
            to note a whole section.
          </>
        )}
      </div>
    )
  }

  return (
    <div className="divide-y divide-line border-b border-line">
      {sorted.map((a, idx) => (
        <AnnotationItem
          key={a.id}
          annotation={a}
          color={a.color ?? colorForId(a.id)}
          active={activeIds.has(a.id)}
          isPlaying={isPlaying}
          currentTime={currentTime}
          readOnly={readOnly}
          autoFocusNew={focusNoteId === a.id}
          onFocusHandled={onFocusHandled}
          canMoveUp={idx > 0 && sameSlot(sorted[idx - 1], a)}
          canMoveDown={idx < sorted.length - 1 && sameSlot(a, sorted[idx + 1])}
          onMoveUp={() => moveNote(a.id, -1)}
          onMoveDown={() => moveNote(a.id, 1)}
          onPlay={() => playNote(a.start)}
          onUpdate={(patch) => onUpdate(a.id, patch)}
          onDelete={() => onDelete(a.id)}
          onSeekNote={onSeekNote}
          mentionItems={mentionItems}
          uploadImage={uploadImage}
          onOpenBlock={
            onOpenBlock ? (blockId) => onOpenBlock(a.id, blockId) : undefined
          }
          openBlockId={
            openWindow?.noteId === a.id ? openWindow.blockId : undefined
          }
        />
      ))}
    </div>
  )
}
