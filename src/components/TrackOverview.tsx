import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Crosshair, ChevronDown, ChevronRight } from 'lucide-react'
import type { Annotation } from '../types'
import { colorForId, hueText } from '../lib/noteColors'
import { formatTime, noteLabel, notePreview } from '../lib/format'
import { resolveTag, tagsOf } from '../lib/tags'
import { loadOverviewZoom, saveOverviewZoom, type OverviewZoom } from '../lib/storage'
import { useResolvedTheme } from '../lib/theme'

interface Props {
  annotations: Annotation[]
  duration: number
  currentTime: number
  isPlaying: boolean
  /** Changing this (e.g. the project id) resets the scroll position. */
  resetKey?: string
  /** Whether the rail is expanded; collapsed shows just this header strip. */
  open: boolean
  /** Toggle the rail open/closed (the header chevron). */
  onToggleOpen: () => void
  /** Scrub to an arbitrary time (clicking the rail background). */
  onSeek: (t: number) => void
  /** Jump to a note and scroll it into view in the notes list. */
  onSeekNote: (id: string) => void
  className?: string
}

// A note without an end occupies 3s for the active-note test (mirrors AnnotationList).
const endOf = (a: Annotation) => (a.end != null ? a.end : a.start + 3)

interface RailNote {
  id: string
  start: number
  end?: number
  isRange: boolean
  /** Marked as a structural section — drawn with a bracket left of the spine. */
  structure: boolean
  /** Optional name shown vertically beside the section bracket. */
  sectionName: string
  color: string
  label: string
  preview: string
}
interface PlacedNote extends RailNote {
  y: number
  yEnd: number | null
  /** Shows a text label at rest (vs. spine tick only) — false when thinned. */
  baseLabel: boolean
}

const PAD = 12 // keeps the 0:00 / end flags off the panel edges
const ROW = 18 // min px gap between two visible labels before the lower thins
const SPINE = 72 // x of the time axis line
const LABEL_X = 80 // x where note labels begin
// Structure-section furniture, in the lane between the time labels and the
// spine: a [ glyph (vertical stroke at BRACKET_X, ticks reaching the spine) with
// the section name set vertically in its own lane just to its left.
const BRACKET_X = SPINE - 16
const BRACKET_W = 8
const NAME_W = 14 // width of the vertical section-name lane
const NAME_X = BRACKET_X - 2 - NAME_W // name sits just left of the bracket

// Zoom is expressed as a time unit: the seconds between gridlines. Each division
// occupies UNIT_PX, so a smaller unit = more zoomed in. 'fit' shows the whole
// track at once. The available units adapt to the track length (see ladderOf).
const UNITS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800]
const UNIT_PX = 56

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
 * A proportional map of the whole track: time runs top→bottom, every note is a
 * color-coded flag at its real position, ranges render as bars, and the amber
 * playhead sweeps down as it plays. The rail is zoomable in time units (buttons
 * or ⌘/Ctrl + wheel, anchored at the cursor) and scrollable; the zoom level is
 * remembered across sessions. A session-stat footer bottoms out the panel.
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
  className = '',
}: Props) {
  const theme = useResolvedTheme()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [railH, setRailH] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
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
  // Accumulates trackpad wheel delta so ⌘/Ctrl + wheel steps one unit per notch.
  const wheelAccumRef = useRef(0)

  // Track the viewport's pixel height: flags are positioned against it and the
  // content height decides when the rail scrolls.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => setRailH(el.clientHeight)
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

  const tagCounts = useMemo(() => {
    const m = new Map<string, { label: string; color: string; count: number }>()
    for (const a of annotations) {
      for (const t of tagsOf(a)) {
        const info = resolveTag(t)
        if (!info) continue
        const e = m.get(t)
        if (e) e.count++
        else m.set(t, { label: info.label, color: info.color, count: 1 })
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count)
  }, [annotations])

  const usableBase = Math.max(0, railH - PAD * 2)
  const effZoom = effectiveZoomOf(zoom, usableBase, duration)
  const pxPerSec = pxPerSecOf(zoom, usableBase, duration)
  const contentH = PAD * 2 + duration * pxPerSec
  const ready = duration > 0 && railH > 40
  const scrollable = ready && contentH > railH + 1
  const yOf = (t: number) => PAD + t * pxPerSec

  const ladder = ladderOf(usableBase, duration)
  const curIdx = Math.max(0, ladder.indexOf(effZoom))
  const canZoomIn = ready && curIdx < ladder.length - 1
  const canZoomOut = ready && curIdx > 0

  // Place each note and decide whether it carries a label at rest. Folding top→
  // down, a note shows its label only if it clears the last shown one by ROW;
  // denser notes keep their spine tick (and reveal their label on hover). Zoom
  // spreads notes out, so more labels survive the fold.
  const placed = useMemo<PlacedNote[]>(() => {
    const ub = Math.max(0, railH - PAD * 2)
    const px = pxPerSecOf(zoom, ub, duration)
    const y = (t: number) => PAD + t * px
    return items.reduce<{ rows: PlacedNote[]; lastLabelY: number }>(
      (st, it) => {
        const top = y(it.start)
        const baseLabel = top - st.lastLabelY >= ROW
        const row: PlacedNote = {
          ...it,
          y: top,
          yEnd: it.isRange ? y(it.end!) : null,
          baseLabel,
        }
        return { rows: [...st.rows, row], lastLabelY: baseLabel ? top : st.lastLabelY }
      },
      { rows: [], lastLabelY: -Infinity },
    ).rows
  }, [items, railH, zoom, duration])

  const primaryActiveId =
    placed.find((p) => currentTime >= p.start && currentTime <= (p.end ?? p.start + 3))
      ?.id ?? null

  // Time gridlines: at fit, the densest "nice" unit that still reads; otherwise
  // the chosen zoom unit itself.
  const gridUnit =
    effZoom === 'fit'
      ? (UNITS.find((s) => s * pxPerSec >= 46) ?? UNITS[UNITS.length - 1])
      : effZoom
  const ticks: number[] = []
  if (ready && gridUnit) {
    for (let t = gridUnit; t < duration - gridUnit * 0.5; t += gridUnit) ticks.push(t)
  }

  // Reset the scroll position when the track changes (zoom is intentionally kept).
  useEffect(() => {
    userScrollingRef.current = false
    if (viewportRef.current) viewportRef.current.scrollTop = 0
  }, [resetKey])

  // Apply the cursor-anchored scroll position after a zoom change re-renders.
  useLayoutEffect(() => {
    const vp = viewportRef.current
    if (vp && pendingScrollRef.current != null) {
      vp.scrollTop = clamp(pendingScrollRef.current, 0, vp.scrollHeight - vp.clientHeight)
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

  // Set zoom while keeping the time under `clientY` (or the viewport centre)
  // stationary — the natural pro-tool zoom feel. Persists the new level.
  const setZoomAnchored = (next: Zoom, clientY: number | null) => {
    const vp = viewportRef.current
    if (!vp || vp.clientHeight <= 0) {
      zoomRef.current = next
      setZoom(next)
      saveOverviewZoom(next)
      return
    }
    const ub = Math.max(0, vp.clientHeight - PAD * 2)
    const oldPx = pxPerSecOf(zoomRef.current, ub, durationRef.current)
    const newPx = pxPerSecOf(next, ub, durationRef.current)
    const h = vp.clientHeight
    const cy = clientY != null ? clientY - vp.getBoundingClientRect().top : h / 2
    const tAt = oldPx > 0 ? (vp.scrollTop + cy - PAD) / oldPx : 0
    pendingScrollRef.current = PAD + tAt * newPx - cy
    zoomRef.current = next
    setZoom(next)
    saveOverviewZoom(next)
  }

  // Step one level along the zoom ladder (dir +1 = in, -1 = out).
  const stepZoom = (dir: 1 | -1, clientY: number | null) => {
    const vp = viewportRef.current
    if (!vp) return
    const ub = Math.max(0, vp.clientHeight - PAD * 2)
    const lad = ladderOf(ub, durationRef.current)
    const eff = effectiveZoomOf(zoomRef.current, ub, durationRef.current)
    const idx = Math.max(0, lad.indexOf(eff))
    setZoomAnchored(lad[clamp(idx + dir, 0, lad.length - 1)], clientY)
  }

  // ⌘/Ctrl + wheel (and trackpad pinch) zooms in time-unit steps, anchored at the
  // cursor; a plain wheel scrolls and pauses the playhead follow.
  useEffect(() => {
    const vp = viewportRef.current
    if (!vp) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        wheelAccumRef.current += e.deltaY
        if (wheelAccumRef.current <= -40) {
          wheelAccumRef.current = 0
          stepZoom(1, e.clientY)
        } else if (wheelAccumRef.current >= 40) {
          wheelAccumRef.current = 0
          stepZoom(-1, e.clientY)
        }
      } else {
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
    const px = pxPerSecOf(zoom, Math.max(0, vp.clientHeight - PAD * 2), duration)
    const fullH = PAD * 2 + duration * px
    const h = vp.clientHeight
    if (fullH <= h + 1) return // fits — nothing to follow
    const y = PAD + currentTime * px
    if (y < vp.scrollTop + h * 0.12 || y > vp.scrollTop + h * 0.88) {
      vp.scrollTop = clamp(y - h / 3, 0, fullH - h)
    }
  }, [currentTime, isPlaying, zoom, duration, railH])

  const scrollToNow = () => {
    const vp = viewportRef.current
    if (!vp || !ready) return
    const y = PAD + currentTime * pxPerSec
    vp.scrollTop = clamp(y - vp.clientHeight / 3, 0, Math.max(0, contentH - vp.clientHeight))
    userScrollingRef.current = false
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = null
    }
  }

  const scrub = (e: React.MouseEvent) => {
    const vp = viewportRef.current
    if (!ready || !vp) return
    const contentY = vp.scrollTop + (e.clientY - vp.getBoundingClientRect().top)
    onSeek(clamp((contentY - PAD) / Math.max(0.0001, pxPerSec), 0, duration))
  }

  const btn =
    'press border border-line bg-inset text-muted hover:text-fg disabled:opacity-30 disabled:hover:text-muted'

  return (
    <section className={`flex flex-col border-t border-line bg-panel ${className}`}>
      {/* Map panel header: collapse toggle (label) + scroll-to-now + zoom. The
          header strip is always shown so the rail can be reopened after it's
          collapsed away. */}
      <div className="flex items-center justify-between border-b border-line bg-raised/60 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          title={open ? 'Hide overview' : 'Show overview'}
          className="press -ml-1 flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-muted hover:text-fg"
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="font-mono text-[11px] uppercase tracking-[0.25em]">
            Overview
          </span>
        </button>
        {open && ready && items.length > 0 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={scrollToNow}
              disabled={!scrollable}
              title="Scroll to the playhead"
              aria-label="Scroll to the playhead"
              className={`${btn} rounded-sm p-1 hover:text-accentink`}
            >
              <Crosshair size={12} />
            </button>
            <div className="flex items-center gap-px" role="group" aria-label="Timeline zoom">
              <button
                type="button"
                onClick={() => stepZoom(-1, null)}
                disabled={!canZoomOut}
                title="Zoom out (longer time unit)"
                aria-label="Zoom out"
                className={`${btn} rounded-l-sm p-1`}
              >
                <ZoomOut size={12} />
              </button>
              <button
                type="button"
                onClick={() => setZoomAnchored('fit', null)}
                disabled={!canZoomOut}
                title="Fit the whole track"
                aria-label="Reset zoom to fit"
                className={`${btn} w-9 border-x-0 py-1 text-center font-mono text-[10px] tabular-nums`}
              >
                {zoomLabel(effZoom)}
              </button>
              <button
                type="button"
                onClick={() => stepZoom(1, null)}
                disabled={!canZoomIn}
                title="Zoom in (shorter time unit)"
                aria-label="Zoom in"
                className={`${btn} rounded-r-sm p-1`}
              >
                <ZoomIn size={12} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* The rail (scroll viewport). Hidden (not unmounted) when collapsed so its
          once-bound ResizeObserver + wheel listeners survive and re-measure on
          reopen. */}
      <div
        ref={viewportRef}
        className={`relative min-h-0 flex-1 overflow-y-auto ${open ? '' : 'hidden'}`}
      >
        {items.length === 0 ? (
          <Hint>Notes you pin will map onto the timeline here.</Hint>
        ) : !ready ? (
          <Hint>Load the track to map its notes along the timeline.</Hint>
        ) : (
          <div className="relative cursor-pointer" style={{ height: contentH }} onClick={scrub}>
            {/* time axis: spine line */}
            <div
              className="absolute w-px bg-line"
              style={{ left: SPINE, top: PAD, height: contentH - PAD * 2 }}
            />
            {/* 0:00 / total end labels */}
            <span
              className="absolute left-2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted"
              style={{ top: PAD }}
            >
              0:00
            </span>
            <span
              className="absolute left-2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted"
              style={{ top: contentH - PAD }}
            >
              {formatTime(duration)}
            </span>

            {/* intermediate time gridlines */}
            {ticks.map((t) => (
              <div key={t} className="pointer-events-none absolute" style={{ top: yOf(t) }}>
                <span className="absolute left-2 -translate-y-1/2 font-mono text-[10px] tabular-nums text-muted/55">
                  {formatTime(t)}
                </span>
                <span
                  className="absolute h-px w-2 -translate-y-1/2 bg-line"
                  style={{ left: SPINE - 4 }}
                />
              </div>
            ))}

            {placed.map((p) => {
              const active =
                currentTime >= p.start && currentTime <= (p.end ?? p.start + 3)
              const primary = p.id === primaryActiveId
              const showLabel = p.baseLabel || hovered === p.id || primary
              const lift = hovered === p.id || active
              const onTop = hovered === p.id || primary
              // Structure bracket spans start→end; a point note gets a small
              // fixed bracket centred on its flag.
              const brkTop = p.yEnd != null ? p.y : p.y - 7
              const brkH = p.yEnd != null ? Math.max(14, p.yEnd - p.y) : 14
              return (
                <div key={p.id}>
                  {/* structure-section bracket, in the lane left of the spine */}
                  {p.structure && (
                    <div
                      className="pointer-events-none absolute"
                      style={{
                        left: BRACKET_X,
                        top: brkTop,
                        height: brkH,
                        width: BRACKET_W,
                        opacity: active ? 1 : 0.85,
                      }}
                    >
                      <div
                        className="absolute inset-y-0 left-0 w-[2px] rounded-full"
                        style={{ background: p.color }}
                      />
                      <div
                        className="absolute left-0 top-0 h-[2px] w-full rounded-full"
                        style={{ background: p.color }}
                      />
                      <div
                        className="absolute bottom-0 left-0 h-[2px] w-full rounded-full"
                        style={{ background: p.color }}
                      />
                    </div>
                  )}

                  {/* section name, set vertically (reading up) left of the bracket.
                      The outer box spans the bracket; the inner label is sticky, so
                      as the rail scrolls it stays pinned to whichever viewport edge
                      the section runs past — clamped within its own span. */}
                  {p.structure && p.sectionName && (
                    <div
                      className="pointer-events-none absolute"
                      style={{ left: NAME_X, top: brkTop, height: brkH, width: NAME_W }}
                    >
                      <div className="sticky flex justify-center" style={{ top: PAD, bottom: PAD }}>
                        <span
                          className="font-mono text-[10px] font-semibold uppercase leading-none tracking-wider"
                          style={{
                            writingMode: 'vertical-rl',
                            transform: 'rotate(180deg)',
                            maxHeight: brkH,
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
                    </div>
                  )}

                  {/* range bar on the spine */}
                  {p.isRange && p.yEnd != null && (
                    <div
                      className="absolute w-[3px] rounded-full"
                      style={{
                        left: SPINE - 1,
                        top: p.y,
                        height: Math.max(2, p.yEnd - p.y),
                        background: p.color,
                        opacity: active ? 1 : 0.8,
                      }}
                    />
                  )}

                  {/* flag marker (click target) on the spine */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSeekNote(p.id)
                    }}
                    onMouseEnter={() => setHovered(p.id)}
                    onMouseLeave={() => setHovered((h) => (h === p.id ? null : h))}
                    title={`${p.label}${p.preview ? ` · ${p.preview}` : ''}`}
                    aria-label={`Seek to note at ${p.label}`}
                    className="press absolute z-10 flex items-center justify-center"
                    style={{
                      left: SPINE - 7,
                      width: 14,
                      top: p.y,
                      height: p.isRange && p.yEnd != null ? Math.max(14, p.yEnd - p.y) : 14,
                      transform: p.isRange ? undefined : 'translateY(-50%)',
                    }}
                  >
                    <span
                      className={`block rotate-45 rounded-[1px] ring-1 ring-ink transition-transform ${
                        lift ? 'scale-125' : ''
                      } ${p.isRange ? 'self-start' : ''}`}
                      style={{ width: 7, height: 7, background: p.color, marginTop: p.isRange ? -1 : 0 }}
                    />
                  </button>

                  {/* note label */}
                  {showLabel && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSeekNote(p.id)
                      }}
                      onMouseEnter={() => setHovered(p.id)}
                      onMouseLeave={() => setHovered((h) => (h === p.id ? null : h))}
                      className={`group absolute flex -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-sm py-0.5 pl-1.5 pr-2 text-left ${
                        primary ? 'bg-raised' : 'hover:bg-raised/60'
                      } ${onTop ? 'z-30' : 'z-20'}`}
                      style={{ left: LABEL_X, top: p.y, maxWidth: `calc(100% - ${LABEL_X + 8}px)` }}
                    >
                      <span
                        className="shrink-0 font-mono text-[11px] font-semibold tabular-nums"
                        style={{ color: hueText(p.color, theme) }}
                      >
                        {p.label}
                      </span>
                      {primary && (
                        <span className="h-1.5 w-1.5 shrink-0 animate-now-pulse rounded-full bg-accent" />
                      )}
                      {p.preview && (
                        <span className="min-w-0 flex-1 truncate text-[11px] text-muted">
                          {p.preview}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              )
            })}

            {/* playhead — amber "now" line sweeping down the rail */}
            <div
              className="pointer-events-none absolute z-40 flex -translate-y-1/2 items-center"
              style={{ top: yOf(currentTime), left: SPINE - 4, right: 8 }}
            >
              <span className="h-2 w-2 shrink-0 rotate-45 bg-accent shadow-[0_0_6px_rgb(245_166_35/0.7)]" />
              <span className="ml-1 h-px flex-1 bg-accent/70" />
            </div>
          </div>
        )}
      </div>

      {/* Session readout — just the tag tallies. */}
      {open && tagCounts.length > 0 && (
        <div className="shrink-0 border-t border-line bg-inset/40 px-3 py-1.5">
          <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
            {tagCounts.map((t) => (
              <span key={t.label} className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.color }} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted">
                  {t.label}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-fg">{t.count}</span>
              </span>
            ))}
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
