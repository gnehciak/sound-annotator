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
  onSeek: (t: number) => void
  onPlay: () => void
  onUpdate: (id: string, patch: Partial<Annotation>) => void
  onDelete: (id: string) => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
}

const endOf = (a: Annotation) => (a.end != null ? a.end : a.start + 3)

export default function AnnotationList({
  annotations,
  currentTime,
  isPlaying,
  readOnly = false,
  scrollRef,
  onSeek,
  onPlay,
  onUpdate,
  onDelete,
  onSeekNote,
  mentionItems,
}: Props) {
  const activeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const a of annotations) {
      if (currentTime >= a.start && currentTime <= endOf(a)) ids.add(a.id)
    }
    return ids
  }, [annotations, currentTime])

  // Order: finished notes on top, then the playing notes, then upcoming.
  const sorted = useMemo(() => {
    const rank = (a: Annotation) => {
      if (currentTime > endOf(a)) return 0 // finished
      if (currentTime >= a.start) return 1 // playing
      return 2 // upcoming
    }
    return [...annotations].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (ra === 0) return endOf(a) - endOf(b) || a.start - b.start
      return a.start - b.start || a.createdAt - b.createdAt
    })
  }, [annotations, currentTime])

  const primaryActiveId = sorted.find((a) => activeIds.has(a.id))?.id ?? null
  const orderSig = sorted.map((a) => a.id).join('|')

  const prevTops = useRef<Map<string, number>>(new Map())
  const prevSig = useRef('')
  const prevPrimary = useRef<string | null>(null)
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

  // Smoothly glide a note to the top, re-reading its position every frame so it
  // keeps tracking the note even as the list reorders underneath it.
  const followToTop = (id: string | null) => {
    cancelFollow()
    if (!id || !scrollRef.current) return
    // Reduced motion: jump straight to the target, no glide.
    if (prefersReducedMotion()) {
      const el = document.getElementById(`note-${id}`)
      if (el) scrollRef.current.scrollTop = Math.max(0, el.offsetTop)
      return
    }
    const step = () => {
      const sc = scrollRef.current
      const el = document.getElementById(`note-${id}`)
      if (!sc || !el) {
        followRaf.current = null
        return
      }
      const target = Math.max(0, el.offsetTop)
      const diff = target - sc.scrollTop
      if (Math.abs(diff) < 0.5) {
        sc.scrollTop = target
        followRaf.current = null
        return
      }
      sc.scrollTop += diff * 0.22
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
      cancelFollow()
      if (returnTimer.current) clearTimeout(returnTimer.current)
      returnTimer.current = window.setTimeout(() => {
        userScrolling.current = false
        if (playingRef.current) followToTop(primaryRef.current)
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
        scroller.scrollTop += pinShift
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

    // When the playing note itself changes, bring the new one to the top
    // (unless the user is scrolling around, or playback is paused — while paused
    // the user is editing and the list shouldn't jump on its own).
    if (activeChanged && primaryActiveId && !userScrolling.current && isPlaying) {
      followToTop(primaryActiveId)
    }

    prevTops.current = newTops
    prevSig.current = orderSig
    prevPrimary.current = primaryActiveId
  })

  // Clicking a note's play button: seek there, start playback, then pin the
  // *first* playing note to the top. A longer note that started earlier keeps
  // the top spot.
  const playNote = (id: string, start: number) => {
    userScrolling.current = false
    if (returnTimer.current) clearTimeout(returnTimer.current)
    onSeek(start)
    onPlay()
    requestAnimationFrame(() => followToTop(primaryRef.current ?? id))
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
      {sorted.map((a) => (
        <AnnotationItem
          key={a.id}
          annotation={a}
          color={a.color ?? colorForId(a.id)}
          active={activeIds.has(a.id)}
          currentTime={currentTime}
          readOnly={readOnly}
          onPlay={() => playNote(a.id, a.start)}
          onUpdate={(patch) => onUpdate(a.id, patch)}
          onDelete={() => onDelete(a.id)}
          onSeekNote={onSeekNote}
          mentionItems={mentionItems}
        />
      ))}
    </div>
  )
}
