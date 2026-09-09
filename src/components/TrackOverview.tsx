import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ZoomIn,
  ZoomOut,
  Crosshair,
  ChevronDown,
  ChevronRight,
  Plus,
  ChevronFirst,
  ChevronLast,
  Scissors,
} from 'lucide-react'
import type { Annotation } from '../types'
import { colorForId, hueText } from '../lib/noteColors'
import { formatTime, noteLabel, notePreview } from '../lib/format'
import { loadOverviewZoom, saveOverviewZoom, type OverviewZoom } from '../lib/storage'
import { useResolvedTheme } from '../lib/theme'
import { useContextMenu } from '../lib/useContextMenu'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'

interface Props {
  annotations: Annotation[]
  duration: number
  currentTime: number
  isPlaying: boolean
  /** Changing this (e.g. the project id) resets the scroll position. */
  resetKey?: string
  /** Whether the strip is expanded; collapsed shows just this header strip. */
  open: boolean
  /** Toggle the strip open/closed (the header chevron). */
  onToggleOpen: () => void
  /** Scrub to an arbitrary time (clicking the strip background). */
  onSeek: (t: number) => void
  /** Jump to a note and scroll it into view in the notes list. */
  onSeekNote: (id: string) => void
  /**
   * The strip's context menu (right-click / long press). Every verb here takes
   * the moment *under the pointer* rather than the playhead — which is the
   * whole reason to have one on a map of the track. All absent in the
   * read-only presentations.
   */
  onAddNoteAt?: (t: number) => void
  /** Mark a section start at this moment (the I key, aimed). */
  onMarkInAt?: (t: number) => void
  /** Close the pending section here, creating the note (the O key, aimed). */
  onMarkOutAt?: (t: number) => void
  /** A section start is pending — `onMarkOutAt` has something to close. */
  pendingIn?: number | null
  /** Trim the clip window to this moment. Video sources only. */
  onTrimStartAt?: (t: number) => void
  onTrimEndAt?: (t: number) => void
  className?: string
}

// A note without an end occupies 3s for the active-note test (mirrors AnnotationList).
const endOf = (a: Annotation) => (a.end != null ? a.end : a.start + 3)

interface RailNote {
  id: string
  start: number
  end?: number
  isRange: boolean
  /** Marked as a structural section — drawn with a bracket hung from the top. */
  structure: boolean
  /** Optional name shown above the section bracket. */
  sectionName: string
  color: string
  label: string
  preview: string
}
interface PlacedNote extends RailNote {
  x: number
  xEnd: number | null
}

const PAD = 12 // keeps the 0:00 / end labels off the timeline edges
const PAD_V = 6 // top/bottom breathing room inside the strip
// The section name sits at the very top; the bracket hangs from just below it
// (kept clear of the text so the stroke never strikes through).
const SECTION_NAME_Y = PAD_V
const SECTION_BRACKET_Y = PAD_V + 13
const DIAMOND = 7 // note flag size (rotated square)

// Zoom is expressed as a time unit: the seconds a division occupies UNIT_PX of,
// so a smaller unit = more zoomed in. 'fit' shows the whole track at once. The
// units below are the ladder the −/+ buttons step through and the ruler draws
// its gridlines from — but the zoom itself is *continuous*, because a pinch
// lands wherever the fingers stop. Only the gridlines snap to a unit.
const UNITS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]
const UNIT_PX = 56
// As tight as the strip goes — the ladder's finest division, so a pinch and the
// + button run out of room in the same place.
const MIN_UNIT = UNITS[0]
// A gridline needs this much room before its timecode is worth drawing.
const TICK_MIN_PX = 46

type Zoom = OverviewZoom // 'fit' | seconds

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const fitPxOf = (usableBase: number, duration: number) =>
  duration > 0 ? usableBase / duration : 0

// Pixels-per-second for a zoom level (never below fit — you can't zoom out past
// the whole track).
const pxPerSecOf = (zoom: Zoom, usableBase: number, duration: number) => {
  const fit = fitPxOf(usableBase, duration)
  return zoom === 'fit' ? fit : Math.max(fit, UNIT_PX / zoom)
}

// A stored unit that's no tighter than fit (e.g. carried to a shorter track) is
// treated as fit for display + stepping.
const effectiveZoomOf = (zoom: Zoom, usableBase: number, duration: number): Zoom => {
  if (zoom === 'fit') return 'fit'
  return UNIT_PX / zoom > fitPxOf(usableBase, duration) * 1.001 ? zoom : 'fit'
}

// The unit that draws the whole track in the viewport: 'fit' said as a number,
// and so the loosest unit there is any point in.
const fitUnitOf = (usableBase: number, duration: number) => {
  const fit = fitPxOf(usableBase, duration)
  return fit > 0 ? UNIT_PX / fit : Infinity
}

// Bring a continuous unit into the strip's range. Anything at or looser than
// fit *is* fit, and is stored as such — so the readout says FIT, and the
// remembered level still means "the whole track" on a track of another length.
const clampZoomUnit = (unit: number, usableBase: number, duration: number): Zoom => {
  if (!Number.isFinite(unit)) return 'fit'
  if (unit >= fitUnitOf(usableBase, duration) * 0.999) return 'fit'
  return Math.max(MIN_UNIT, unit)
}

// Zoom levels from most zoomed-out (fit) to most zoomed-in (smallest unit),
// dropping units that would be looser than fit for this track.
const ladderOf = (usableBase: number, duration: number): Zoom[] => {
  const fit = fitPxOf(usableBase, duration)
  const zoomedIn = UNITS.filter((u) => UNIT_PX / u > fit * 1.001).sort((a, b) => b - a)
  return ['fit', ...zoomedIn]
}

const zoomLabel = (zoom: Zoom) => {
  if (zoom === 'fit') return 'FIT'
  if (zoom < 60) return `${zoom}s`
  return `${zoom / 60}m`
}

/**
 * A proportional map of the whole track laid out as a short horizontal strip:
 * time runs left→right, every note is a color-coded flag at its real position,
 * ranges render as bars, section notes get a bracket hung from the top, and the
 * amber playhead sweeps right as it plays. Hovering a flag pops a preview. The
 * strip zooms smoothly, anchored at the cursor — a trackpad pinch (⌘/Ctrl +
 * wheel) or two fingers on glass move it continuously, while the −/+ buttons
 * step the ladder of time units — and scrolls horizontally; the zoom level is
 * remembered across sessions. A tag-tally footer bottoms out the panel.
 */
export default function TrackOverview({
  annotations,
  duration,
  currentTime,
  isPlaying,
  resetKey,
  open,
  onToggleOpen,
  onSeek,
  onSeekNote,
  onAddNoteAt,
  onMarkInAt,
  onMarkOutAt,
  pendingIn = null,
  onTrimStartAt,
  onTrimEndAt,
  className = '',
}: Props) {
  const theme = useResolvedTheme()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [railW, setRailW] = useState(0)
  // The hovered flag + the viewport-relative x where it was entered, so its
  // preview popover can float just above the strip at the flag.
  const [hover, setHover] = useState<{ id: string; x: number } | null>(null)
  // The header's height — the popover floats just above the strip below it.
  const [headerH, setHeaderH] = useState(0)
  const measureHeader = (el: HTMLDivElement | null) => {
    if (el) setHeaderH(el.offsetHeight)
  }
  const [zoom, setZoom] = useState<Zoom>(loadOverviewZoom)

  // Latest zoom/duration for the once-bound wheel listener; written only in
  // handlers/effects, never during render.
  const zoomRef = useRef<Zoom>(zoom)
  const durationRef = useRef(duration)
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  // Suppress playhead auto-follow for a beat after the user scrolls by hand.
  const userScrollingRef = useRef(false)
  const scrollTimerRef = useRef<number | null>(null)
  // Scroll position to apply after a zoom re-render (keeps the cursor anchored).
  const pendingScrollRef = useRef<number | null>(null)
  // A pinch changes the zoom every frame, so the remembered level is only
  // written once the fingers stop — and flushed if the strip goes away first.
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<Zoom | null>(null)
  const saveZoomSoon = (z: Zoom) => {
    pendingSaveRef.current = z
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      pendingSaveRef.current = null
      saveOverviewZoom(z)
    }, 400)
  }
  useEffect(
    () => () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        if (pendingSaveRef.current != null) saveOverviewZoom(pendingSaveRef.current)
      }
    },
    [],
  )

  // Track the viewport's pixel size: flags are positioned against it, the width
  // drives the time scale, and the content width decides when the strip scrolls.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setRailW(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Per-note display data (sorted by start). Previews parse HTML, so memoise on
  // the notes — not on every playhead tick.
  const items = useMemo<RailNote[]>(
    () =>
      [...annotations]
        .sort((a, b) => a.start - b.start || endOf(a) - endOf(b))
        .map((a) => ({
          id: a.id,
          start: a.start,
          end: a.end,
          isRange: a.end != null,
          structure: a.structure ?? false,
          sectionName: a.sectionName?.trim() ?? '',
          color: a.color ?? colorForId(a.id),
          label: noteLabel(a.start, a.end),
          preview: notePreview(a.contentHtml),
        })),
    [annotations],
  )

  const usableBase = Math.max(0, railW - PAD * 2)
  const effZoom = effectiveZoomOf(zoom, usableBase, duration)
  const pxPerSec = pxPerSecOf(zoom, usableBase, duration)
  const contentW = PAD * 2 + duration * pxPerSec
  const ready = duration > 0 && railW > 40
  const scrollable = ready && contentW > railW + 1
  const xOf = (t: number) => PAD + t * pxPerSec

  // Vertical lane geometry: sections pin to the top, the ruler to the bottom, the
  // spine sits just below the (optional) section lane.
  const hasSections = items.some((it) => it.structure)
  const spineY = PAD_V + (hasSections ? 32 : 8)
  // Ruler sits just below the spine (a short gridline gap), and the strip is
  // only as tall as it needs to be — no dead space under the timecodes.
  const rulerY = spineY + 14
  const stripH = rulerY + 16

  // A pinch lands between the ladder's rungs, so there's no index to compare —
  // what's left is simply whether there's room to go further either way.
  const canZoomIn = ready && pxPerSec < UNIT_PX / MIN_UNIT - 0.001
  const canZoomOut = ready && effZoom !== 'fit'

  // Place each note along the time axis.
  const placed = useMemo<PlacedNote[]>(() => {
    const ub = Math.max(0, railW - PAD * 2)
    const px = pxPerSecOf(zoom, ub, duration)
    const x = (t: number) => PAD + t * px
    return items.map((it) => ({
      ...it,
      x: x(it.start),
      xEnd: it.isRange ? x(it.end!) : null,
    }))
  }, [items, railW, zoom, duration])

  // Time gridlines: the densest "nice" unit that still has room to be read.
  // Read off the scale rather than the zoom level, since between two rungs of
  // the ladder there is no level to name — and at a rung it names that rung.
  const gridUnit = UNITS.find((s) => s * pxPerSec >= TICK_MIN_PX) ?? UNITS[UNITS.length - 1]
  const ticks: number[] = []
  if (ready && gridUnit) {
    for (let t = gridUnit; t < duration - gridUnit * 0.5; t += gridUnit) ticks.push(t)
  }

  // Reset the scroll position when the track changes (zoom is intentionally kept).
  useEffect(() => {
    userScrollingRef.current = false
    if (viewportRef.current) viewportRef.current.scrollLeft = 0
  }, [resetKey])

  // Apply the cursor-anchored scroll position after a zoom change re-renders.
  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (vp && pendingScrollRef.current != null) {
      vp.scrollLeft = clamp(pendingScrollRef.current, 0, vp.scrollWidth - vp.clientWidth)
      pendingScrollRef.current = null
    }
  }, [zoom])

  const markUserScrolling = () => {
    userScrollingRef.current = true
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = window.setTimeout(() => {
      userScrollingRef.current = false
    }, 3500)
  }

  // Set zoom while keeping the time under `clientX` (or the viewport centre)
  // stationary — the natural pro-tool zoom feel. Persists the new level.
  const setZoomAnchored = (next: Zoom, clientX: number | null) => {
    // Nothing to anchor if the level didn't move — and a pending scroll left
    // behind here would be applied to whatever zoom came next.
    if (next === zoomRef.current) return
    const vp = viewportRef.current
    if (!vp || vp.clientWidth <= 0) {
      zoomRef.current = next
      setZoom(next)
      saveZoomSoon(next)
      return
    }
    const ub = Math.max(0, vp.clientWidth - PAD * 2)
    const oldPx = pxPerSecOf(zoomRef.current, ub, durationRef.current)
    const newPx = pxPerSecOf(next, ub, durationRef.current)
    const w = vp.clientWidth
    const cx = clientX != null ? clientX - vp.getBoundingClientRect().left : w / 2
    const tAt = oldPx > 0 ? (vp.scrollLeft + cx - PAD) / oldPx : 0
    pendingScrollRef.current = PAD + tAt * newPx - cx
    zoomRef.current = next
    setZoom(next)
    saveZoomSoon(next)
  }

  // Step to the next rung of the ladder past where the strip is now (dir +1 =
  // in, -1 = out). Found by scale rather than by index, because a pinch will
  // often have left the strip between two rungs.
  const stepZoom = (dir: 1 | -1, clientX: number | null) => {
    const vp = viewportRef.current
    if (!vp) return
    const ub = Math.max(0, vp.clientWidth - PAD * 2)
    const dur = durationRef.current
    const px = pxPerSecOf(zoomRef.current, ub, dur)
    const lad = ladderOf(ub, dur)
    const pxOf = (z: Zoom) => pxPerSecOf(z, ub, dur)
    const next =
      dir === 1
        ? lad.find((z) => pxOf(z) > px * 1.001)
        : [...lad].reverse().find((z) => pxOf(z) < px * 0.999)
    if (next != null) setZoomAnchored(next, clientX)
  }

  // Zoom by a ratio about `clientX` — the shape a pinch arrives in, whether
  // from a trackpad's ctrl+wheel or two fingers on glass. Zooming by hand
  // pauses the playhead follow, exactly as scrolling by hand does: the strip
  // must stay where it was left rather than snap back to the playhead.
  const zoomByFactor = (factor: number, clientX: number | null) => {
    const vp = viewportRef.current
    if (!vp) return
    const ub = Math.max(0, vp.clientWidth - PAD * 2)
    const dur = durationRef.current
    const px = pxPerSecOf(zoomRef.current, ub, dur)
    if (px <= 0 || !(factor > 0)) return
    markUserScrolling()
    setZoomAnchored(clampZoomUnit(UNIT_PX / (px * factor), ub, dur), clientX)
  }

  // A trackpad pinch reaches the page as a ⌘/Ctrl + wheel event — there is no
  // pinch event on the desktop web, and the browser zooms the whole *page* if
  // we don't take it — so it zooms continuously, anchored at the cursor; a
  // plain wheel pans the timeline horizontally and pauses the follow.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        // The exponent turns a delta into a ratio, so the same pinch travels
        // the same proportion of the range wherever it starts from. Clamped
        // per event because trackpads disagree wildly about scale — some send
        // single digits a frame, some fifty — and the latter would otherwise
        // cross the whole range in two frames.
        zoomByFactor(Math.exp(-clamp(e.deltaY, -40, 40) / 260), e.clientX)
      } else if (vp.scrollWidth > vp.clientWidth + 1) {
        // Translate vertical wheel to horizontal pan so a plain scroll wheel
        // still moves the timeline.
        const horiz = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        e.preventDefault()
        vp.scrollLeft += horiz
        markUserScrolling()
      }
    }
    vp.addEventListener('wheel', onWheel, { passive: false })
    vp.addEventListener('touchmove', markUserScrolling, { passive: true })
    return () => {
      vp.removeEventListener('wheel', onWheel)
      vp.removeEventListener('touchmove', markUserScrolling)
    }
    // Handlers only read refs + stable setters, so binding once is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the playhead in view while playing (unless the user just scrolled).
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !isPlaying || userScrollingRef.current || duration <= 0) return
    const px = pxPerSecOf(zoom, Math.max(0, vp.clientWidth - PAD * 2), duration)
    const fullW = PAD * 2 + duration * px
    const w = vp.clientWidth
    if (fullW <= w + 1) return // fits — nothing to follow
    const x = PAD + currentTime * px
    if (x < vp.scrollLeft + w * 0.12 || x > vp.scrollLeft + w * 0.88) {
      vp.scrollLeft = clamp(x - w / 3, 0, fullW - w)
    }
  }, [currentTime, isPlaying, zoom, duration, railW])

  const scrollToNow = () => {
    const vp = viewportRef.current
    if (!vp || !ready) return
    const x = PAD + currentTime * pxPerSec
    vp.scrollLeft = clamp(x - vp.clientWidth / 3, 0, Math.max(0, contentW - vp.clientWidth))
    userScrollingRef.current = false
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = null
    }
  }

  // Touch pinch: two pointers, and the ratio of the distance between them.
  const touchesRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<number | null>(null)
  // When the last pinch moved, so the finger that lifts off it isn't also read
  // as a tap asking to seek there.
  const pinchedAtRef = useRef(0)
  const pinchHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerType !== 'touch' || !touchesRef.current.has(e.pointerId)) return
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touchesRef.current.size !== 2) return
      const [a, b] = [...touchesRef.current.values()]
      const gap = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinchRef.current != null && pinchRef.current > 0) {
        pinchedAtRef.current = performance.now()
        zoomByFactor(gap / pinchRef.current, (a.x + b.x) / 2)
      }
      pinchRef.current = gap
    },
    onPointerUp: (e: React.PointerEvent) => {
      touchesRef.current.delete(e.pointerId)
      if (touchesRef.current.size < 2) pinchRef.current = null
    },
    onPointerCancel: (e: React.PointerEvent) => {
      touchesRef.current.delete(e.pointerId)
      if (touchesRef.current.size < 2) pinchRef.current = null
    },
  }

  const scrub = (e: React.MouseEvent) => {
    const vp = viewportRef.current
    if (!ready || !vp) return
    if (performance.now() - pinchedAtRef.current < 400) return
    const contentX = vp.scrollLeft + (e.clientX - vp.getBoundingClientRect().left)
    onSeek(clamp((contentX - PAD) / Math.max(0.0001, pxPerSec), 0, duration))
  }

  const hoverNote = hover ? placed.find((p) => p.id === hover.id) : null

  // ---- the strip's context menu ------------------------------------------
  // Everything here is addressed to the moment under the pointer, which is
  // what the strip is for: a time you can see and point at, but would
  // otherwise have to seek to first. The time is captured when the menu opens
  // — the playhead may well move while it's up.
  const menu = useContextMenu()
  const [menuAt, setMenuAt] = useState<number | null>(null)
  const hasMenu = !!(onAddNoteAt || onMarkInAt || onTrimStartAt)
  const openMenu = (e: React.MouseEvent) => {
    const vp = viewportRef.current
    if (!ready || !vp) return
    const contentX = vp.scrollLeft + (e.clientX - vp.getBoundingClientRect().left)
    setMenuAt(clamp((contentX - PAD) / Math.max(0.0001, pxPerSec), 0, duration))
    menu.handlers.onContextMenu(e)
  }
  const menuItems: ContextMenuItem[] = []
  if (menuAt != null) {
    const at = menuAt
    const stamp = formatTime(at)
    if (onAddNoteAt) {
      menuItems.push({
        key: 'add',
        label: 'Add note here',
        icon: Plus,
        hint: stamp,
        onSelect: () => onAddNoteAt(at),
      })
    }
    if (onMarkInAt) {
      menuItems.push({
        key: 'in',
        label: 'Section starts here',
        icon: ChevronFirst,
        hint: stamp,
        onSelect: () => onMarkInAt(at),
      })
    }
    if (onMarkOutAt) {
      menuItems.push({
        key: 'out',
        label: 'Section ends here',
        icon: ChevronLast,
        hint: pendingIn != null ? `from ${formatTime(pendingIn)}` : undefined,
        disabled: pendingIn == null || at <= pendingIn,
        disabledTitle:
          pendingIn == null
            ? 'Mark where the section starts first'
            : 'A section has to end after it starts',
        onSelect: () => onMarkOutAt(at),
      })
    }
    if (onTrimStartAt) {
      menuItems.push({
        key: 'trim-start',
        label: 'Trim the start to here',
        icon: Scissors,
        hint: stamp,
        separated: menuItems.length > 0,
        onSelect: () => onTrimStartAt(at),
      })
    }
    if (onTrimEndAt) {
      menuItems.push({
        key: 'trim-end',
        label: 'Trim the end to here',
        icon: Scissors,
        hint: stamp,
        onSelect: () => onTrimEndAt(at),
      })
    }
    // No zoom item: the header's −/FIT/+ is always on screen a few pixels
    // away. What the menu is for is the verbs that have no control anywhere —
    // the ones addressed to the moment under the pointer.
  }


  return (
    <section
      className={`relative flex flex-col border-t border-line/70 ${className}`}
    >
      {/* Map panel header — the whole bar toggles the strip open/closed (the zoom
          controls stop propagation). Always shown so it can be reopened after
          it's collapsed away. */}
      <div
        ref={measureHeader}
        role="button"
        tabIndex={0}
        onClick={onToggleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggleOpen()
          }
        }}
        aria-expanded={open}
        title={open ? 'Hide overview' : 'Show overview'}
        className="flex h-[38px] shrink-0 cursor-pointer items-center justify-between border-b border-line/70 bg-fg/[0.03] px-3 text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <span className="flex items-center gap-[7px]">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.25em]">
            Overview
          </span>
        </span>
        {open && ready && items.length > 0 && (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={scrollToNow}
              disabled={!scrollable}
              title="Scroll to the playhead"
              aria-label="Scroll to the playhead"
              className="btn-icon press h-6 w-[26px] hover:text-accentink"
            >
              <Crosshair size={12} />
            </button>
            <div className="seg" role="group" aria-label="Timeline zoom">
              <button
                type="button"
                onClick={() => stepZoom(-1, null)}
                disabled={!canZoomOut}
                title="Zoom out (longer time unit)"
                aria-label="Zoom out"
                className="seg-item press h-5 w-[26px] px-0"
              >
                <ZoomOut size={12} />
              </button>
              <button
                type="button"
                onClick={() => setZoomAnchored('fit', null)}
                disabled={!canZoomOut}
                title="Fit the whole track"
                aria-label="Reset zoom to fit"
                className="seg-item press h-5 w-[38px] px-0 tabular-nums"
              >
                {zoomLabel(effZoom === 'fit' ? 'fit' : gridUnit)}
              </button>
              <button
                type="button"
                onClick={() => stepZoom(1, null)}
                disabled={!canZoomIn}
                title="Zoom in (shorter time unit)"
                aria-label="Zoom in"
                className="seg-item press h-5 w-[26px] px-0"
              >
                <ZoomIn size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The collapsible timeline + tag footer. Slides open/closed via the grid
          row 0fr↔1fr trick; the viewport keeps a fixed height so the timeline
          never reflows mid-slide, and stays mounted so its once-bound listeners
          survive. */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-instr"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
       <div className="overflow-hidden">
      <div
        ref={viewportRef}
        {...pinchHandlers}
        className="relative overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
        // `pan-x` keeps the horizontal scroll but hands the pinch to us rather
        // than to the browser's own page zoom.
        style={{ height: stripH, scrollbarWidth: 'none', touchAction: 'pan-x' }}
      >
        {items.length === 0 ? (
          <Hint>Notes you pin will map onto the timeline here.</Hint>
        ) : !ready ? (
          <Hint>Load the track to map its notes along the timeline.</Hint>
        ) : (
          <div
            className="relative h-full cursor-pointer"
            style={{ width: contentW }}
            onClick={scrub}
            {...(hasMenu ? { ...menu.handlers, onContextMenu: openMenu } : null)}
          >
            {/* time axis: spine line */}
            <div
              className="absolute h-px bg-line"
              style={{ left: PAD, top: spineY, width: Math.max(0, contentW - PAD * 2) }}
            />
            {/* 0:00 / total end labels at the ruler */}
            <span
              className="absolute font-mono text-[10px] tabular-nums text-muted"
              style={{ left: PAD, top: rulerY }}
            >
              0:00
            </span>
            <span
              className="absolute font-mono text-[10px] tabular-nums text-muted"
              style={{ left: contentW - PAD, top: rulerY, transform: 'translateX(-100%)' }}
            >
              {formatTime(duration)}
            </span>

            {/* intermediate time gridlines + timecodes */}
            {ticks.map((t) => (
              <div key={t} className="pointer-events-none absolute" style={{ left: xOf(t) }}>
                <span
                  className="absolute w-px -translate-x-1/2 bg-line/60"
                  style={{ top: spineY, height: Math.max(0, rulerY - spineY) }}
                />
                <span
                  className="absolute -translate-x-1/2 font-mono text-[10px] tabular-nums text-muted/55"
                  style={{ top: rulerY }}
                >
                  {formatTime(t)}
                </span>
              </div>
            ))}

            {placed.map((p) => {
              const active =
                currentTime >= p.start && currentTime <= (p.end ?? p.start + 3)
              const lift = hover?.id === p.id || active
              // Section bracket spans start→end; a point section gets a small
              // fixed bracket centred on its flag.
              const secLeft = p.xEnd != null ? p.x : p.x - 7
              const secW = p.xEnd != null ? Math.max(2, p.xEnd - p.x) : 14
              return (
                <div key={p.id}>
                  {/* structure-section bracket, hung from the top of the strip */}
                  {p.structure && (
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: secLeft,
                        top: SECTION_BRACKET_Y,
                        width: secW,
                        opacity: active ? 1 : 0.85,
                      }}
                    >
                      <div
                        className="absolute left-0 top-0 h-[2px] w-full rounded-full"
                        style={{ background: p.color }}
                      />
                      <div
                        className="absolute left-0 top-0 h-[6px] w-[2px] rounded-full"
                        style={{ background: p.color }}
                      />
                      <div
                        className="absolute right-0 top-0 h-[6px] w-[2px] rounded-full"
                        style={{ background: p.color }}
                      />
                    </div>
                  )}

                  {/* section name above the bracket. The outer box spans the
                      section; the inner label is sticky, so as the strip scrolls
                      it stays pinned to whichever edge the section runs past —
                      clamped within its own span. */}
                  {p.structure && p.sectionName && (
                    <div
                      className="pointer-events-none absolute"
                      style={{ left: secLeft, top: SECTION_NAME_Y, width: secW }}
                    >
                      <span
                        className="sticky inline-block align-top font-mono text-[10px] font-semibold uppercase leading-none tracking-[0.1em]"
                        style={{
                          left: PAD,
                          right: PAD,
                          maxWidth: secW,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: hueText(p.color, theme),
                          opacity: active ? 1 : 0.85,
                        }}
                      >
                        {p.sectionName}
                      </span>
                    </div>
                  )}

                  {/* range bar on the spine */}
                  {p.isRange && p.xEnd != null && (
                    <div
                      className="absolute rounded-full"
                      style={{
                        left: p.x,
                        top: spineY - 1.5,
                        width: Math.max(2, p.xEnd - p.x),
                        height: 3,
                        background: p.color,
                        opacity: active ? 1 : 0.8,
                      }}
                    />
                  )}

                  {/* flag marker (click target + hover preview) on the spine */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSeekNote(p.id)
                    }}
                    onMouseEnter={(e) =>
                      setHover({
                        id: p.id,
                        x: e.clientX - (viewportRef.current?.getBoundingClientRect().left ?? 0),
                      })
                    }
                    onMouseLeave={() => setHover((h) => (h?.id === p.id ? null : h))}
                    aria-label={`Seek to note at ${p.label}`}
                    className="press absolute z-10 flex items-center"
                    style={{
                      left: p.x,
                      top: spineY,
                      width: p.isRange && p.xEnd != null ? Math.max(14, p.xEnd - p.x) : 14,
                      height: 14,
                      justifyContent: p.isRange ? 'flex-start' : 'center',
                      transform: p.isRange ? 'translateY(-50%)' : 'translate(-50%, -50%)',
                    }}
                  >
                    <span
                      className={`block rotate-45 rounded-[1.5px] ring-1 ring-ink transition-transform ${
                        lift ? 'scale-125' : ''
                      }`}
                      style={{ width: DIAMOND, height: DIAMOND, background: p.color }}
                    />
                  </button>
                </div>
              )
            })}

            {/* playhead — amber "now" line sweeping right across the strip */}
            <div
              className="pointer-events-none absolute z-40"
              style={{ left: xOf(currentTime), top: 0, bottom: 0 }}
            >
              <span
                className="absolute w-px -translate-x-1/2 bg-accent/70"
                style={{ top: PAD_V, bottom: PAD_V, left: 0 }}
              />
              <span
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-accent shadow-[0_0_6px_rgb(var(--accent)/0.7)]"
                style={{ top: spineY, left: 0 }}
              />
            </div>
          </div>
        )}
      </div>

       </div>
      </div>

      {hasMenu && (
        <ContextMenu
          point={menu.point}
          items={menuItems}
          onClose={menu.close}
          label={menuAt != null ? `Timeline at ${formatTime(menuAt)}` : 'Timeline'}
        />
      )}

      {/* hover preview popover — floats just above the timeline strip at the flag */}
      {hover && hoverNote && (
        <div
          className="pointer-events-none absolute z-50 -translate-x-1/2 -translate-y-full"
          style={{
            left: clamp(hover.x, 124, Math.max(124, railW - 124)),
            top: headerH - 4,
            maxWidth: 248,
          }}
        >
          <div className="pop px-2.5 py-2">
            <span
              className="font-mono text-[11px] font-semibold tabular-nums"
              style={{ color: hueText(hoverNote.color, theme) }}
            >
              {hoverNote.label}
            </span>
            {hoverNote.preview && (
              <p
                className="mt-0.5 text-[11px] leading-snug text-fg"
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {hoverNote.preview}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="max-w-[16rem] text-xs leading-relaxed text-muted">{children}</p>
    </div>
  )
}
