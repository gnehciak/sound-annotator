import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  MousePointer2,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize,
} from 'lucide-react'
import type { Annotation } from '../../types'
import { formatTime, noteLabel, parseTime } from '../../lib/format'
import { colorForId } from '../../lib/noteColors'
import {
  SECTION_PRESETS,
  dedupedName,
  presetFor,
  sectionAt,
  sectionName,
  sortedSections,
} from '../../lib/sections'
import { useHotkeys } from '../../lib/useHotkeys'
import TitleBar from '../TitleBar'

/**
 * The song-structure board: the whole editing surface of a 'structure'
 * project. A zoomable timeline where the project's annotations render as
 * colored section blocks (Intro / Verse / Chorus…) that are created by
 * dragging across empty track, moved/resized by direct manipulation, cut in
 * two with the Cut tool, and named/recolored from a preset detail row.
 * A minimap gives the whole-song picture and drives pan/zoom; the ruler
 * scrubs the player; the playhead is the one signal-colored element (the
 * Signal-Is-Now rule).
 *
 * Owns only view state (tool, zoom window, selection, in-flight drags).
 * All data mutations go up through the on* props, which App routes into the
 * undoable annotation history — so ⌘Z works across every gesture here.
 */

interface Props {
  /** The project's sections (all of its annotations, in any order). */
  sections: Annotation[]
  duration: number
  currentTime: number
  isPlaying: boolean
  readOnly: boolean
  onSeek: (t: number) => void
  /** Create a section (id minted by the caller of the gesture). */
  onCreate: (id: string, start: number, end: number) => void
  /** Cut a section in two at time t. */
  onSplit: (id: string, t: number) => void
  onUpdate: (
    id: string,
    patch: Partial<Annotation>,
    opts?: { coalesceKey?: string },
  ) => void
  onDelete: (id: string) => void
}

type Tool = 'select' | 'cut'

const MAX_ZOOM = 32
/** Shortest section a gesture can produce, in seconds. */
const MIN_SECTION = 0.5
/** Magnetic snap radius, in screen pixels. */
const SNAP_PX = 7

const round1 = (x: number) => Math.round(x * 10) / 10
const clamp = (x: number, lo: number, hi: number) =>
  Math.min(Math.max(x, lo), hi)

/** #rrggbb + alpha → #rrggbbaa (section hues are always 6-digit hex). */
const hexA = (hex: string, a: number) =>
  `${hex}${Math.round(clamp(a, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')}`

/** Grid quantum for a zoom level: finer as pixels-per-second grows. */
const gridFor = (pps: number) => (pps >= 48 ? 0.1 : pps >= 12 ? 0.5 : 1)

/**
 * Run a drag gesture on window-level listeners (the pointer leaves the lane
 * constantly at this scale). Freezes the cursor + text selection for the
 * gesture's lifetime; each closure reads fresh state through refs.
 */
function windowDrag(
  onMove: (ev: PointerEvent) => void,
  onUp?: (ev: PointerEvent) => void,
  cursor?: string,
) {
  const move = (ev: PointerEvent) => onMove(ev)
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    onUp?.(ev)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  if (cursor) document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
}

/** Quantize to the grid, then let nearby magnet times (section edges, the
 *  playhead, the track ends) win within SNAP_PX. */
function snapTime(t: number, pps: number, magnets: number[]): number {
  let out = Math.round(t / gridFor(pps)) * gridFor(pps)
  let best = SNAP_PX + 1
  for (const m of magnets) {
    const d = Math.abs(m - t) * pps
    if (d < best) {
      best = d
      out = m
    }
  }
  return out
}

export default function StructureEditor({
  sections,
  duration,
  currentTime,
  isPlaying,
  readOnly,
  onSeek,
  onCreate,
  onSplit,
  onUpdate,
  onDelete,
}: Props) {
  const [tool, setTool] = useState<Tool>('select')
  // Selection is derived defensively: an id that no longer exists (deleted,
  // undone) simply matches nothing, and read-only mode masks it entirely.
  const [rawSelectedId, setSelectedId] = useState<string | null>(null)
  const selectedId = readOnly ? null : rawSelectedId
  // The zoom window in seconds; null = the whole track ("fit").
  const [view, setView] = useState<{ s: number; e: number } | null>(null)
  // Live preview of a drag-to-create gesture (committed on release).
  const [ghost, setGhost] = useState<{ s: number; e: number } | null>(null)
  // Focus the name field once the just-created section lands in props.
  const pendingFocusRef = useRef<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Before the player reports a duration, fall back to the sections' extent
  // so an already-built board still lays out (times just can't exceed it).
  const dur = useMemo(() => {
    const maxEnd = Math.max(0, ...sections.map((a) => a.end ?? a.start))
    return duration > 0 ? duration : Math.max(60, maxEnd)
  }, [duration, sections])

  const vs = view?.s ?? 0
  const ve = view?.e ?? dur

  const ordered = useMemo(() => sortedSections(sections), [sections])
  const selected = selectedId
    ? sections.find((a) => a.id === selectedId) ?? null
    : null
  const nowSection = sectionAt(ordered, currentTime)

  // Timeline geometry: one rect for the ruler + lane column.
  const timelineRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const pps = width > 0 && ve > vs ? width / (ve - vs) : 1
  const xOf = (t: number) => (t - vs) * pps

  // Latest values for the window-level drag listeners (they outlive renders).
  const liveRef = useRef({ sections, ordered, vs, ve, dur, pps, currentTime })
  useEffect(() => {
    liveRef.current = { sections, ordered, vs, ve, dur, pps, currentTime }
  })

  /** Clamp + apply a view window; a window ≈ the whole track collapses to fit. */
  const applyView = useCallback((s: number, e: number) => {
    const d = liveRef.current.dur
    const span = clamp(e - s, Math.max(1, d / MAX_ZOOM), d)
    const start = clamp(s, 0, d - span)
    setView(span >= d * 0.999 ? null : { s: start, e: start + span })
  }, [])

  const zoomTo = useCallback(
    (factor: number, anchor: number) => {
      const { vs, ve, dur } = liveRef.current
      const f = clamp(factor, 1, MAX_ZOOM)
      if (f <= 1.001) {
        setView(null)
        return
      }
      const span = dur / f
      const frac = clamp((anchor - vs) / (ve - vs), 0, 1)
      applyView(anchor - frac * span, anchor - frac * span + span)
    },
    [applyView],
  )

  const zoom = dur / (ve - vs)
  const zoomAnchor =
    currentTime >= vs && currentTime <= ve ? currentTime : (vs + ve) / 2

  // Keep a playing playhead on screen while zoomed: page the window forward
  // when it just crossed the right edge (never on far manual seeks).
  useEffect(() => {
    if (!isPlaying || !view) return
    const span = view.e - view.s
    if (currentTime > view.e && currentTime <= view.e + span)
      applyView(currentTime - span * 0.08, currentTime - span * 0.08 + span)
  }, [currentTime, isPlaying, view, applyView])

  // Focus the name field once a freshly created section exists in props.
  useEffect(() => {
    if (!selected || pendingFocusRef.current !== selected.id) return
    pendingFocusRef.current = null
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [selected])

  // Tool + selection keys (App owns transport keys; V stays the view toggle).
  useHotkeys((e) => {
    if (readOnly) return
    const k = e.key.toLowerCase()
    if (k === 's') setTool('select')
    else if (k === 'c') setTool('cut')
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault()
      onDelete(selectedId)
      setSelectedId(null)
    } else if (e.key === 'Escape' && selectedId && !e.defaultPrevented) {
      setSelectedId(null)
    }
  })

  /** clientX → seconds, against the timeline's current rect. */
  const tOfClient = (clientX: number) => {
    const rect = timelineRef.current?.getBoundingClientRect()
    const { vs, ve } = liveRef.current
    if (!rect || rect.width === 0) return vs
    return vs + ((clientX - rect.left) / rect.width) * (ve - vs)
  }

  /** Every magnetic snap target except the dragged section's own edges. */
  const magnetsExcept = (id?: string) => {
    const { ordered, dur, currentTime } = liveRef.current
    const out = [0, dur, currentTime]
    for (const a of ordered) {
      if (a.id === id) continue
      out.push(a.start)
      if (a.end != null) out.push(a.end)
    }
    return out
  }

  /** The empty gap around time t: [previous section's end, next one's start]. */
  const gapAt = (t: number, exceptId?: string) => {
    const { ordered, dur } = liveRef.current
    let lo = 0
    let hi = dur
    for (const a of ordered) {
      if (a.id === exceptId) continue
      const end = a.end ?? a.start
      if (end <= t + 1e-6) lo = Math.max(lo, end)
      if (a.start >= t - 1e-6) hi = Math.min(hi, a.start)
    }
    return { lo, hi }
  }

  // ---- gestures ------------------------------------------------------------

  function scrubDrag(clientX: number) {
    const seekAt = (cx: number) =>
      onSeek(clamp(tOfClient(cx), 0, liveRef.current.dur))
    seekAt(clientX)
    windowDrag((ev) => seekAt(ev.clientX))
  }

  function panDrag(clientX: number) {
    const { vs, ve, pps } = liveRef.current
    const s0 = vs
    const span = ve - vs
    windowDrag((ev) => {
      const dx = (ev.clientX - clientX) / pps
      applyView(s0 - dx, s0 - dx + span)
    }, undefined, 'grabbing')
  }

  /** Cut-tool click: cut the section under t, or fill the gap around t. */
  function cutAt(t: number) {
    const { ordered, pps } = liveRef.current
    const hit = sectionAt(ordered, t)
    if (hit) {
      onSplit(hit.id, round1(snapTime(t, pps, [liveRef.current.currentTime])))
      return
    }
    const { lo, hi } = gapAt(t)
    if (hi - lo >= MIN_SECTION) {
      const id = crypto.randomUUID()
      onCreate(id, lo, hi)
      setSelectedId(id)
      pendingFocusRef.current = id
    }
  }

  function onLaneDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const t = clamp(tOfClient(e.clientX), 0, liveRef.current.dur)
    if (e.shiftKey) return panDrag(e.clientX)
    if (readOnly) return scrubDrag(e.clientX)
    if (tool === 'cut') return cutAt(t)

    // Select tool on empty track: a drag sketches a new section inside the
    // gap under the pointer; a plain click deselects and cues the playhead.
    const { lo, hi } = gapAt(t)
    const magnets = magnetsExcept()
    const anchor = clamp(snapTime(t, liveRef.current.pps, magnets), lo, hi)
    const x0 = e.clientX
    let g: { s: number; e: number } | null = null
    windowDrag(
      (ev) => {
        if (g == null && Math.abs(ev.clientX - x0) < 4) return
        const cur = clamp(
          snapTime(tOfClient(ev.clientX), liveRef.current.pps, magnets),
          lo,
          hi,
        )
        g = { s: Math.min(anchor, cur), e: Math.max(anchor, cur) }
        setGhost(g)
      },
      () => {
        setGhost(null)
        if (g && g.e - g.s >= MIN_SECTION) {
          const id = crypto.randomUUID()
          onCreate(id, g.s, g.e)
          setSelectedId(id)
          pendingFocusRef.current = id
        } else {
          setSelectedId(null)
          onSeek(anchor)
        }
      },
    )
  }

  const onBlockDown = (sec: Annotation) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (e.shiftKey) return // bubbles to the lane's pan gesture
    e.stopPropagation()
    const t = tOfClient(e.clientX)
    if (readOnly) {
      onSeek(sec.start)
      return
    }
    if (tool === 'cut') return cutAt(t)

    setSelectedId(sec.id)
    const end = sec.end ?? sec.start
    const len = end - sec.start
    const { lo, hi } = gapAt((sec.start + end) / 2, sec.id)
    const boundLo = Math.min(lo, sec.start)
    const boundHi = Math.max(hi, end)
    const grab = t - sec.start
    const magnets = magnetsExcept(sec.id)
    const x0 = e.clientX
    let moved = false
    windowDrag(
      (ev) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return
        moved = true
        const { pps } = liveRef.current
        const raw = tOfClient(ev.clientX) - grab
        // Snap whichever edge lands nearest a magnet: start directly, or the
        // end via magnet-minus-length ghosts.
        const ns = clamp(
          snapTime(raw, pps, [...magnets, ...magnets.map((m) => m - len)]),
          boundLo,
          boundHi - len,
        )
        onUpdate(
          sec.id,
          { start: round1(ns), end: round1(ns + len) },
          { coalesceKey: `sec-move:${sec.id}` },
        )
      },
      undefined,
      'grabbing',
    )
  }

  const onHandleDown =
    (sec: Annotation, edge: 'start' | 'end') => (e: React.PointerEvent) => {
      if (e.button !== 0 || e.shiftKey || readOnly || tool !== 'select') return
      e.stopPropagation()
      setSelectedId(sec.id)
      const end = sec.end ?? sec.start
      const { lo, hi } = gapAt((sec.start + end) / 2, sec.id)
      const magnets = magnetsExcept(sec.id)
      windowDrag(
        (ev) => {
          const { pps, sections } = liveRef.current
          const cur = sections.find((a) => a.id === sec.id)
          if (!cur) return
          const curEnd = cur.end ?? cur.start
          const raw = snapTime(tOfClient(ev.clientX), pps, magnets)
          const patch =
            edge === 'start'
              ? {
                  start: round1(
                    clamp(raw, Math.min(lo, cur.start), curEnd - MIN_SECTION),
                  ),
                }
              : {
                  end: round1(
                    clamp(raw, cur.start + MIN_SECTION, Math.max(hi, curEnd)),
                  ),
                }
          onUpdate(sec.id, patch, { coalesceKey: `sec-resize:${sec.id}` })
        },
        undefined,
        'ew-resize',
      )
    }

  // ---- minimap -------------------------------------------------------------
  const miniRef = useRef<HTMLDivElement>(null)
  function onMiniDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const rect = miniRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const toT = (cx: number) =>
      clamp(((cx - rect.left) / rect.width) * liveRef.current.dur, 0, liveRef.current.dur)
    const xL = rect.left + (vs / dur) * rect.width
    const xR = rect.left + (ve / dur) * rect.width
    const span = ve - vs

    if (Math.abs(e.clientX - xL) <= 6) {
      // Drag the left edge: zoom with the right edge pinned.
      const fixedE = ve
      windowDrag(
        (ev) =>
          applyView(
            Math.min(toT(ev.clientX), fixedE - Math.max(1, dur / MAX_ZOOM)),
            fixedE,
          ),
        undefined,
        'ew-resize',
      )
    } else if (Math.abs(e.clientX - xR) <= 6) {
      const fixedS = vs
      windowDrag(
        (ev) =>
          applyView(
            fixedS,
            Math.max(toT(ev.clientX), fixedS + Math.max(1, dur / MAX_ZOOM)),
          ),
        undefined,
        'ew-resize',
      )
    } else if (view && e.clientX >= xL && e.clientX <= xR) {
      // Drag the window body to pan.
      const offset = toT(e.clientX) - vs
      windowDrag(
        (ev) => {
          const s = toT(ev.clientX) - offset
          applyView(s, s + span)
        },
        undefined,
        'grabbing',
      )
    } else if (view) {
      // Click outside the window: center it there, keep dragging to pan.
      const t0 = toT(e.clientX)
      applyView(t0 - span / 2, t0 + span / 2)
      windowDrag((ev) => {
        const t = toT(ev.clientX)
        applyView(t - span / 2, t + span / 2)
      })
    } else {
      // Fully zoomed out the minimap doubles as a scrubber.
      onSeek(toT(e.clientX))
      windowDrag((ev) => onSeek(toT(ev.clientX)))
    }
  }

  // ---- zoom via wheel ------------------------------------------------------
  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const { vs, ve, pps, dur } = liveRef.current
      if (e.shiftKey) {
        // Shift+scroll zooms around the cursor (some platforms report the
        // shifted wheel on deltaX — take whichever axis actually moved).
        e.preventDefault()
        const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX
        const rect = el.getBoundingClientRect()
        const anchor = vs + ((e.clientX - rect.left) / rect.width) * (ve - vs)
        zoomTo((dur / (ve - vs)) * Math.exp(-d * 0.0022), anchor)
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        // Horizontal trackpad scroll pans the window.
        e.preventDefault()
        applyView(vs + e.deltaX / pps, ve + e.deltaX / pps)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomTo, applyView])

  // ---- ruler ticks + lane grid ---------------------------------------------
  const ticks = useMemo(() => {
    if (width <= 0 || ve <= vs) return { major: [] as { x: number; label: string }[], minor: [] as number[] }
    const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200]
    const step = STEPS.find((s) => s * pps >= 56) ?? 1200
    const major: { x: number; label: string }[] = []
    for (let t = Math.ceil(vs / step) * step; t <= ve + 1e-6; t += step)
      major.push({ x: (t - vs) * pps, label: formatTime(t) })
    const minorStep = step / 4
    const minor: number[] = []
    if (minorStep * pps >= 13)
      for (let t = Math.ceil(vs / minorStep) * minorStep; t <= ve + 1e-6; t += minorStep)
        if (Math.abs(t / step - Math.round(t / step)) > 1e-6)
          minor.push((t - vs) * pps)
    return { major, minor }
  }, [width, vs, ve, pps])

  const playheadX = xOf(currentTime)
  const playheadVisible = currentTime >= vs && currentTime <= ve

  const laneCursor = readOnly
    ? 'pointer'
    : tool === 'cut'
      ? 'col-resize'
      : 'crosshair'

  // ---- header toolbar ------------------------------------------------------
  const toolBtn = (t: Tool, icon: React.ReactNode, label: string, key: string, title: string) => (
    <button
      type="button"
      onClick={() => setTool(t)}
      aria-pressed={tool === t}
      title={title}
      className={`press flex h-[24px] items-center gap-1.5 rounded px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
        tool === t ? 'bg-raised text-accentink' : 'text-muted hover:text-fg'
      }`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
      <kbd className="kbd-cap hidden min-[1200px]:inline-flex">{key}</kbd>
    </button>
  )

  const headerActions = (
    <div className="flex min-w-0 items-center gap-2.5">
      {!readOnly && (
        <div
          role="group"
          aria-label="Timeline tool"
          className="flex items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]"
        >
          {toolBtn(
            'select',
            <MousePointer2 size={12} />,
            'Select',
            'S',
            'Select tool — drag empty track to sketch a section; drag blocks to move, edges to trim (S)',
          )}
          {toolBtn(
            'cut',
            <Scissors size={12} />,
            'Cut',
            'C',
            'Cut tool — click a section to cut it there; click a gap to fill it (C)',
          )}
        </div>
      )}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => zoomTo(zoom / 1.5, zoomAnchor)}
          disabled={zoom <= 1.001}
          title="Zoom out"
          aria-label="Zoom out"
          className="press grid h-[24px] w-[24px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-35"
        >
          <ZoomOut size={13} />
        </button>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round((Math.log(zoom) / Math.log(MAX_ZOOM)) * 100)}
          onChange={(e) =>
            zoomTo(MAX_ZOOM ** (Number(e.target.value) / 100), zoomAnchor)
          }
          aria-label="Zoom level"
          title="Zoom (Shift+scroll on the timeline)"
          className="w-20 accent-accent"
        />
        <button
          type="button"
          onClick={() => zoomTo(zoom * 1.5, zoomAnchor)}
          disabled={zoom >= MAX_ZOOM * 0.999}
          title="Zoom in"
          aria-label="Zoom in"
          className="press grid h-[24px] w-[24px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-35"
        >
          <ZoomIn size={13} />
        </button>
        <button
          type="button"
          onClick={() => setView(null)}
          disabled={!view}
          title="Fit the whole track"
          aria-label="Zoom to fit"
          className="press grid h-[24px] w-[24px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-35"
        >
          <Maximize size={12} />
        </button>
      </div>
    </div>
  )

  return (
    <section
      aria-label="Song structure timeline"
      className="flex shrink-0 flex-col border-t border-line bg-panel"
    >
      <TitleBar
        left="Song structure"
        right={`${sections.length} ${sections.length === 1 ? 'section' : 'sections'}`}
        actions={headerActions}
      />

      {/* Section chips — the song's form at a glance; click to cue. */}
      {ordered.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto border-b border-line px-3.5 py-2">
          {ordered.map((sec) => {
            const color = sec.color ?? colorForId(sec.id)
            const isNow = nowSection?.id === sec.id
            const isSel = sec.id === selectedId
            return (
              <button
                key={sec.id}
                type="button"
                onClick={() => {
                  onSeek(sec.start)
                  if (!readOnly) setSelectedId(sec.id)
                }}
                title={`${sectionName(sec)} · ${noteLabel(sec.start, sec.end)}`}
                className={`press flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-[3px] text-[11px] font-medium transition-colors ${
                  isNow
                    ? 'border-accent/70 bg-accent/10 text-accentink'
                    : isSel
                      ? 'border-line-strong bg-raised text-fg'
                      : 'border-line text-fg hover:border-line-strong'
                }`}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: color }}
                />
                {sectionName(sec)}
              </button>
            )
          })}
        </div>
      )}

      {/* Minimap — the whole song; drag the window to pan, its edges to zoom. */}
      <div className="px-3.5 pb-1 pt-2">
        <div
          ref={miniRef}
          onPointerDown={onMiniDown}
          title={
            view
              ? 'Drag the window to pan · drag its edges to zoom · click to jump'
              : 'Drag to scrub · drag the edges in to zoom'
          }
          className="bevel-inset relative h-[24px] touch-none overflow-hidden rounded-sm border border-line bg-inset"
        >
          {ordered.map((sec) => {
            const end = sec.end ?? sec.start
            return (
              <div
                key={sec.id}
                aria-hidden
                className="absolute inset-y-[3px] rounded-[2px]"
                style={{
                  left: `${(sec.start / dur) * 100}%`,
                  width: `${Math.max(((end - sec.start) / dur) * 100, 0.4)}%`,
                  background: hexA(sec.color ?? colorForId(sec.id), 0.75),
                }}
              />
            )
          })}
          {/* Dim everything outside the zoom window. */}
          {view && (
            <>
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 bg-ink/55"
                style={{ width: `${(vs / dur) * 100}%` }}
              />
              <div
                aria-hidden
                className="absolute inset-y-0 right-0 bg-ink/55"
                style={{ width: `${((dur - ve) / dur) * 100}%` }}
              />
            </>
          )}
          {/* The window frame + its grab edges. */}
          <div
            aria-hidden
            className="absolute inset-y-0 rounded-[3px] shadow-[inset_0_0_0_1.5px_rgb(var(--text)/0.65)]"
            style={{
              left: `${(vs / dur) * 100}%`,
              width: `${((ve - vs) / dur) * 100}%`,
            }}
          >
            <div className="absolute inset-y-0 -left-[3px] w-[7px] cursor-ew-resize" />
            <div className="absolute inset-y-0 -right-[3px] w-[7px] cursor-ew-resize" />
          </div>
          <div
            aria-hidden
            className="absolute inset-y-0 w-px bg-accent"
            style={{ left: `${clamp(currentTime / dur, 0, 1) * 100}%` }}
          />
        </div>
      </div>

      {/* Ruler + section lane. */}
      <div ref={timelineRef} className="relative mx-3.5 mb-2 mt-1">
        <div
          onPointerDown={(e) => {
            if (e.button === 0) scrubDrag(e.clientX)
          }}
          title="Click or drag to seek"
          className="relative h-[20px] cursor-pointer touch-none overflow-hidden rounded-t-sm border border-b-0 border-line bg-panel"
        >
          {ticks.minor.map((x) => (
            <span
              key={`m${x}`}
              aria-hidden
              className="absolute bottom-0 h-[5px] w-px bg-line"
              style={{ left: x }}
            />
          ))}
          {ticks.major.map((tk) => (
            <span key={tk.x} aria-hidden>
              <span
                className="absolute bottom-0 h-[9px] w-px bg-line-strong"
                style={{ left: tk.x }}
              />
              <span
                className="absolute top-[2px] font-mono text-[9px] tabular-nums leading-none text-muted"
                style={{ left: tk.x + 4 }}
              >
                {tk.label}
              </span>
            </span>
          ))}
        </div>

        <div
          onPointerDown={onLaneDown}
          className="bevel-inset relative h-[96px] touch-none overflow-hidden rounded-b-sm border border-line bg-inset"
          style={{ cursor: laneCursor }}
        >
          {/* Faint grid continuing the ruler's majors. */}
          {ticks.major.map((tk) => (
            <span
              key={tk.x}
              aria-hidden
              className="absolute inset-y-0 w-px bg-line/40"
              style={{ left: tk.x }}
            />
          ))}

          {ordered.length === 0 && (
            <p className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              {readOnly
                ? 'No sections yet'
                : 'Drag across the track to sketch the first section'}
            </p>
          )}

          {ordered.map((sec) => {
            const end = sec.end ?? sec.start
            if (end < vs || sec.start > ve) return null
            const left = xOf(sec.start)
            const w = Math.max(xOf(end) - left, 2)
            const color = sec.color ?? colorForId(sec.id)
            const isSel = sec.id === selectedId
            const canGrab = !readOnly && tool === 'select'
            return (
              <div
                key={sec.id}
                role="button"
                tabIndex={0}
                aria-label={`${sectionName(sec)}, ${noteLabel(sec.start, sec.end)}`}
                onPointerDown={onBlockDown(sec)}
                onDoubleClick={() => onSeek(sec.start)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (readOnly) onSeek(sec.start)
                    else setSelectedId(sec.id)
                  }
                }}
                title={`${sectionName(sec)} · ${noteLabel(sec.start, sec.end)}`}
                className={`group absolute inset-y-0 touch-none overflow-hidden border-x outline-none ${
                  isSel ? 'z-10 shadow-[inset_0_0_0_1.5px_rgb(var(--text)/0.6)]' : ''
                }`}
                style={{
                  left,
                  width: w,
                  background: hexA(color, isSel ? 0.52 : 0.3),
                  borderColor: hexA(color, 0.85),
                  cursor: canGrab ? 'grab' : undefined,
                }}
              >
                {w > 34 && (
                  <span
                    className="pointer-events-none absolute left-1.5 top-1.5 max-w-[calc(100%-12px)] truncate rounded-sm px-1.5 py-[2px] font-mono text-[10px] font-semibold leading-none text-onbright"
                    style={{ background: color }}
                  >
                    {sectionName(sec)}
                  </span>
                )}
                {w > 76 && (
                  <span className="pointer-events-none absolute bottom-1 left-1.5 font-mono text-[9px] tabular-nums leading-none text-fg/60">
                    {formatTime(sec.start)}
                  </span>
                )}
                {canGrab && (
                  <>
                    <div
                      aria-hidden
                      onPointerDown={onHandleDown(sec, 'start')}
                      className="absolute inset-y-0 left-0 w-[7px] cursor-ew-resize"
                    >
                      <span
                        className="absolute inset-y-0 left-0 w-[3px] opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ background: color }}
                      />
                    </div>
                    <div
                      aria-hidden
                      onPointerDown={onHandleDown(sec, 'end')}
                      className="absolute inset-y-0 right-0 w-[7px] cursor-ew-resize"
                    >
                      <span
                        className="absolute inset-y-0 right-0 w-[3px] opacity-0 transition-opacity group-hover:opacity-100"
                        style={{ background: color }}
                      />
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {ghost && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 z-20 rounded-[3px] border border-dashed border-accent bg-accent/10"
              style={{ left: xOf(ghost.s), width: Math.max(xOf(ghost.e) - xOf(ghost.s), 2) }}
            >
              <span className="absolute left-1 top-1.5 font-mono text-[9px] tabular-nums text-accentink">
                {formatTime(ghost.e - ghost.s)}
              </span>
            </div>
          )}
        </div>

        {/* Playhead — the one signal-colored mark: "now". */}
        {playheadVisible && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 z-20 w-[2px] -translate-x-1/2 bg-accent"
            style={{ left: playheadX }}
          >
            <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[rgb(var(--accent))]" />
          </div>
        )}
      </div>

      {/* Footer — a FIXED slot so selecting a section never reflows the
          board: the selected section's controls, or a one-line hint. */}
      {!readOnly && (
      <div className="flex h-11 items-center gap-x-3 overflow-hidden border-t border-line bg-panel px-3.5">
      {selected ? (
        <>
          <span
            aria-hidden
            className="h-3.5 w-3.5 shrink-0 rounded-sm"
            style={{ background: selected.color ?? colorForId(selected.id) }}
          />
          <input
            ref={nameRef}
            value={selected.sectionName ?? ''}
            onChange={(e) =>
              onUpdate(
                selected.id,
                { sectionName: e.target.value },
                { coalesceKey: `sec-name:${selected.id}` },
              )
            }
            placeholder="Section name"
            aria-label="Section name"
            className="bevel-inset w-36 rounded border border-line bg-inset px-2 py-[4px] text-[12.5px] text-fg outline-none transition-colors placeholder:text-muted focus:border-accent"
          />
          <div
            role="group"
            aria-label="Section presets"
            className="flex min-w-0 items-center gap-1 overflow-x-auto"
          >
            {SECTION_PRESETS.map((p) => {
              const active =
                presetFor(selected.sectionName ?? '')?.name === p.name
              return (
                <button
                  key={p.name}
                  type="button"
                  onClick={() =>
                    onUpdate(selected.id, {
                      sectionName: dedupedName(
                        p.name,
                        sections.filter((a) => a.id !== selected.id),
                      ),
                      color: p.color,
                    })
                  }
                  title={`Name this section “${p.name}”`}
                  className={`press flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-[2px] font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] transition-colors ${
                    active
                      ? 'bg-raised text-fg'
                      : 'border-line text-muted hover:text-fg'
                  }`}
                  style={active ? { borderColor: p.color } : undefined}
                >
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: p.color }}
                  />
                  {p.name}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <TimeField
              label="Section start"
              value={selected.start}
              onCommit={(t) => {
                const end = selected.end ?? selected.start
                const { lo } = gapAt((selected.start + end) / 2, selected.id)
                onUpdate(selected.id, {
                  start: round1(clamp(t, Math.min(lo, selected.start), end - MIN_SECTION)),
                })
              }}
            />
            –
            <TimeField
              label="Section end"
              value={selected.end ?? selected.start}
              onCommit={(t) => {
                const end = selected.end ?? selected.start
                const { hi } = gapAt((selected.start + end) / 2, selected.id)
                onUpdate(selected.id, {
                  end: round1(clamp(t, selected.start + MIN_SECTION, Math.max(hi, end))),
                })
              }}
            />
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => {
              onDelete(selected.id)
              setSelectedId(null)
            }}
            title="Delete section (⌫)"
            aria-label="Delete section"
            className="press grid h-[26px] w-[26px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </>
      ) : (
        <p className="truncate text-[12px] text-muted">
          Drag across the track to draw a section — click one to name it.
        </p>
      )}
      </div>
      )}
    </section>
  )
}

/** Editable m:ss field (Enter/blur commits, Escape cancels) — the transport's
 *  time-entry pattern, sized for the detail row. */
function TimeField({
  value,
  label,
  onCommit,
}: {
  value: number
  label: string
  onCommit: (seconds: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const skipRef = useRef(false)
  return (
    <input
      value={editing ? draft : formatTime(value)}
      onFocus={() => {
        setEditing(true)
        setDraft(formatTime(value))
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          skipRef.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={() => {
        if (!skipRef.current) {
          const parsed = parseTime(draft)
          if (parsed != null) onCommit(parsed)
        }
        skipRef.current = false
        setEditing(false)
      }}
      aria-label={`${label} — type a time (m:ss) and press Enter`}
      title="Type a time (m:ss or seconds) and press Enter"
      className="w-[52px] rounded border border-transparent bg-transparent px-1 py-[2px] text-center font-mono text-[11px] tabular-nums text-fg outline-none transition-colors hover:border-line hover:bg-inset focus:border-accent focus:bg-inset"
    />
  )
}
