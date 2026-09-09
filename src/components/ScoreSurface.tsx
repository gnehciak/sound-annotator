import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Loader2, TriangleAlert } from 'lucide-react'
import type { ScoreFit } from '../types'
import type { LoadedPdf, PageSize } from '../lib/pdf'
import { usePinTarget } from '../lib/pinTargets'
import { MAX_ZOOM, MIN_ZOOM, clampZoom } from '../lib/score'

/** How far beyond the viewport a page is still worth drawing, in viewports. */
const RENDER_MARGIN = 0.75

/** Gap between stacked pages, in CSS pixels. */
const PAGE_GAP = 14

/**
 * How far the reader must scroll before the render window is recomputed, in
 * pixels. Small next to a viewport of `RENDER_MARGIN`, so nothing is ever
 * missed; large enough that a flick doesn't re-render the tree per frame.
 */
const SCROLL_BAND = 160

/** How long after the last pinch to redraw the pages sharply. */
const ZOOM_SETTLE_MS = 160

interface Props {
  pdf: LoadedPdf
  /** The page the reader should be looking at — scrolled to when it changes. */
  page: number
  fit: ScoreFit
  /** Multiplier on the fitted size. 1 is "as the fit says". */
  zoom: number
  /**
   * Room to leave for the chrome floating over this surface, in pixels — the
   * page nav above and the tools and transport below.
   *
   * Numbers rather than padding classes because the layout needs to *do
   * arithmetic* with them: a page's offset in the scroller is its offset in
   * the stack plus the top inset, and the box a page is fitted to is the
   * scroller minus both. Reading that back off the DOM would mean measuring a
   * ref during render.
   */
  pad: { top: number; bottom: number }
  /**
   * Stack every page and scroll between them, rather than showing the one
   * page. Off for the layer drawn over the video, which is inert background
   * and has no room to scroll.
   */
  continuous: boolean
  /** Whether the reader may scroll, zoom and draw here. */
  interactive: boolean
  /** The page the reader has scrolled to, when *they* did the scrolling. */
  onUserPage?: (page: number) => void
  onZoom?: (zoom: number) => void
  /**
   * Drawn inside a page's box, so it moves and scales with the page. Given the
   * page number and its pixel size — a mark or a pin is stored as a fraction
   * and has to be turned back into pixels to be drawn without distorting it.
   */
  overlay?: (page: number, size: PageSize) => ReactNode
}

/**
 * The document: every page stacked in one scroller, drawn at whatever size the
 * fit and the zoom ask for.
 *
 * Continuous rather than a page at a time because that is how music is read —
 * a system runs off the foot of one page and onto the head of the next, and a
 * reader following along needs to see both at the turn. It is also what lets a
 * page turn be a *scroll* rather than a cut: the next page is already there,
 * below.
 *
 * Every page's box is reserved from its intrinsic size before anything is
 * drawn (`pdf.pageSize`), so the scrollbar tells the truth about a fifty-page
 * score on the first frame. Only the pages near the viewport are rasterised;
 * the rest are white paper of exactly the right shape, which is what a reader
 * skimming past at speed sees anyway.
 */
export default function ScoreSurface({
  pdf,
  page,
  fit,
  zoom,
  pad,
  continuous,
  interactive,
  onUserPage,
  onZoom,
  overlay,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<PageSize | null>(null)
  const [sizes, setSizes] = useState<PageSize[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  /**
   * How far down the reader is, **quantised**. Which pages are worth
   * rasterising is derived from this, so it has to be state — but a scroll
   * fires events by the dozen and this component renders a page tree, so
   * storing the raw offset would re-render everything several times a frame
   * and make the very scroll that caused it stutter. Rounding to a band means
   * a re-render only when the reader has actually travelled far enough to
   * change the answer, and `SCROLL_BAND` is small next to `RENDER_MARGIN`, so
   * the approximation never shows.
   */
  const [band, setBand] = useState(0)
  const bandRef = useRef(0)

  /**
   * The zoom the *rasters* are drawn at, which lags the zoom the layout uses.
   *
   * A pinch arrives as a stream of wheel events; re-rasterising every page on
   * each one would queue a full pdf.js render per tick and turn a gesture into
   * a slideshow. The page boxes resize immediately, so the browser stretches
   * the bitmap it already has — blurry for a moment, but continuous under the
   * fingers — and the sharp redraw lands once the gesture stops.
   */
  const [renderZoom, setRenderZoom] = useState(zoom)
  const zoomTimer = useRef<number | null>(null)
  useEffect(() => {
    if (zoomTimer.current) window.clearTimeout(zoomTimer.current)
    zoomTimer.current = window.setTimeout(() => setRenderZoom(zoom), ZOOM_SETTLE_MS)
    return () => {
      if (zoomTimer.current) window.clearTimeout(zoomTimer.current)
    }
  }, [zoom])

  const pageCount = pdf.pageCount
  const pages = useMemo(
    () => (continuous ? Array.from({ length: pageCount }, (_, i) => i + 1) : [page]),
    [continuous, pageCount, page],
  )

  // Every page's intrinsic size, read once per document. Cheap — pdf.js reads
  // the page dictionary without rasterising — and it is what lets the stack be
  // laid out before a single page is drawn.
  useEffect(() => {
    let alive = true
    void Promise.all(
      Array.from({ length: pageCount }, (_, i) => pdf.pageSize(i + 1)),
    ).then(
      (all) => alive && setSizes(all),
      () => alive && setFailed('That score would not open.'),
    )
    return () => {
      alive = false
    }
  }, [pdf, pageCount])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      // Round: a sub-pixel wobble from the surrounding flex layout would
      // otherwise re-lay-out the document on every frame of a resize.
      setBox({ width: Math.round(width), height: Math.round(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /**
   * The scale one page is drawn at. Per page rather than one for the document,
   * because a score can mix a portrait page with a landscape one and fitting
   * the pair to a single number would crop whichever lost.
   */
  const scaleAt = useCallback(
    (n: number, factor: number): number => {
      const size = sizes?.[n - 1]
      if (!size || !box) return 0
      // The page is fitted to what the chrome leaves, not to the whole
      // scroller — a page fitted edge to edge would hide its title under the
      // page nav and its last system under the tools.
      const room = { width: box.width, height: box.height - pad.top - pad.bottom }
      if (room.width < 8 || room.height < 8) return 0
      const base =
        fit === 'width'
          ? room.width / size.width
          : Math.min(room.height / size.height, room.width / size.width)
      return Math.max(0.01, base * factor)
    },
    [sizes, box, fit, pad.top, pad.bottom],
  )
  const scaleOf = useCallback((n: number) => scaleAt(n, zoom), [scaleAt, zoom])
  const rasterScaleOf = useCallback(
    (n: number) => scaleAt(n, renderZoom),
    [scaleAt, renderZoom],
  )

  /** Each page's laid-out box, and the offset it starts at in the stack. */
  const layout = useMemo(() => {
    if (!sizes || !box) return null
    // Offsets are in the scroller's own coordinates — the top inset included —
    // so a page's `top` is exactly what `scrollTo` and the visibility maths
    // both want, with nothing to reconcile between them.
    let top = pad.top
    const out = pages.map((n) => {
      const scale = scaleOf(n)
      const size = sizes[n - 1]
      const laid = {
        page: n,
        top,
        width: Math.max(1, size.width * scale),
        height: Math.max(1, size.height * scale),
      }
      top += laid.height + PAGE_GAP
      return laid
    })
    return { pages: out, height: top - PAGE_GAP + pad.bottom }
  }, [pages, sizes, box, scaleOf, pad.top, pad.bottom])

  // ---- which pages to draw, and which page the reader is on ---------------

  /**
   * How much of each page is on screen at `top`, and which page wins.
   *
   * "On screen" is the band the chrome doesn't cover, not the whole scroller:
   * a page showing only under the page nav is not the page being read.
   */
  const seenAt = useCallback(
    (top: number) => {
      if (!layout || !box) return null
      const visible = top + pad.top
      const bottom = top + box.height - pad.bottom
      const margin = box.height * RENDER_MARGIN
      const near = new Set<number>()
      let best = { page: layout.pages[0]?.page ?? 1, seen: -Infinity }
      for (const p of layout.pages) {
        const pageTop = p.top
        const pageBottom = pageTop + p.height
        if (pageBottom > visible - margin && pageTop < bottom + margin) near.add(p.page)
        const seen = Math.min(pageBottom, bottom) - Math.max(pageTop, visible)
        if (seen > best.seen) best = { page: p.page, seen }
      }
      return { current: best.page, near }
    },
    [layout, box, pad.top, pad.bottom],
  )

  /**
   * The pages worth rasterising: those on screen plus a margin either side, so
   * a scroll meets drawn paper rather than a blank that fills in behind it.
   * Derived from the scroll position rather than pushed into state by the
   * scroll handler — the handler then has one job, and the first frame gets
   * the right window without an effect to seed it.
   */
  const live = useMemo(
    () => seenAt(band * SCROLL_BAND)?.near ?? new Set<number>([1]),
    [seenAt, band],
  )

  /**
   * A scroll this component started, which must not be read back as the reader
   * choosing a page. Cleared when the scroll settles — `scrollend` where the
   * browser has it, a timer everywhere else — because a smooth scroll fires
   * dozens of scroll events on its way and every one of them would otherwise
   * look like a reader turning away from the music.
   */
  const auto = useRef(false)
  const autoTimer = useRef<number | null>(null)
  const reportedPage = useRef(page)
  /** The page this component last scrolled to of its own accord. */
  const lastTarget = useRef<number | null>(null)

  /** Report where the reader has ended up, if it isn't where we think. */
  const reportPage = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const m = seenAt(el.scrollTop)
    if (m && m.current !== reportedPage.current) {
      reportedPage.current = m.current
      // Claim the page *before* telling the host, so that when the new page
      // comes back down as a prop the effect below recognises it as somewhere
      // the reader already is. Without this the two chase each other: you
      // scroll into a page, we report it, it arrives as the page to show, and
      // the view snaps to its top edge — mid-scroll, every time.
      lastTarget.current = m.current
      onUserPage?.(m.current)
    }
  }, [seenAt, onUserPage])

  /**
   * Stop listening to the scroll position until it settles, then reconcile.
   *
   * The suppression is what keeps a smooth scroll from being read back as the
   * reader turning away from the music — it fires dozens of scroll events on
   * the way, each of them over a different page. The *reconcile* is what keeps
   * a scroll made during that window from vanishing: a reader who grabs the
   * page mid-animation has still chosen a page, and without this the readout
   * would sit on the old one until they happened to scroll again.
   */
  const endAuto = useCallback(() => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current)
    autoTimer.current = null
    auto.current = false
    reportPage()
  }, [reportPage])

  const settleAuto = useCallback(() => {
    if (autoTimer.current) window.clearTimeout(autoTimer.current)
    auto.current = true
    autoTimer.current = window.setTimeout(endAuto, 900)
  }, [endAuto])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = Math.round(el.scrollTop / SCROLL_BAND)
    if (next !== bandRef.current) {
      bandRef.current = next
      setBand(next)
    }
    if (!auto.current) reportPage()
  }, [reportPage])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scrollend', endAuto)
    return () => el.removeEventListener('scrollend', endAuto)
  }, [endAuto])

  // ---- following: bring `page` into view ----------------------------------

  // Smooth, because this is what a page turn looks like now: the music reaches
  // the turn and the paper moves, the way a page turner moves it. A cut would
  // lose the one thing a stack buys — seeing the join.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !layout || !continuous) return
    // Nothing new to go to. This is the common case and it has to be a plain
    // no-op: the effect also re-runs whenever the layout changes, so anything
    // clever here would move the page out from under a reader who merely
    // resized the window or pinched to zoom.
    if (page === lastTarget.current) return
    const target = layout.pages.find((p) => p.page === page)
    if (!target) return
    lastTarget.current = page
    reportedPage.current = page
    // Where the scroller has to sit for this page to start just under the
    // chrome rather than behind it.
    const top = Math.max(0, target.top - pad.top)
    // Already there — the first mount. Scrolling would arm the settle window
    // for nothing, and a reader's scroll landing inside it would then be
    // suppressed for no reason.
    if (Math.abs(el.scrollTop - top) < 2) return
    settleAuto()
    el.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [page, layout, continuous, settleAuto, pad.top])

  // ---- pinch to zoom -------------------------------------------------------

  /**
   * Zoom, anchored on whatever the reader is pointing at.
   *
   * A trackpad pinch reaches the page as a `wheel` event with `ctrlKey` set —
   * there is no separate pinch event on the desktop web, and the browser will
   * zoom the whole *page* instead if we don't take it. Touch is a real
   * two-finger gesture, tracked through pointer events below.
   */
  // Where to put the scroll after a zoom, applied once the relayout has
  // happened rather than during it: the new scroll extent doesn't exist until
  // the pages have been re-sized, so setting it any earlier would be clamped
  // to the old one and the page would walk away from the bar you pinched on.
  const anchor = useRef<{ x: number; y: number } | null>(null)

  const zoomAround = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const el = scrollRef.current
      if (!el || !onZoom) return
      const next = clampZoom(zoom * factor)
      if (next === zoom) return
      const rect = el.getBoundingClientRect()
      // The document point under the pointer has to stay under it, or a pinch
      // walks the page away from the bar you were looking at.
      const x = (el.scrollLeft + clientX - rect.left) * (next / zoom) - (clientX - rect.left)
      const y = (el.scrollTop + clientY - rect.top) * (next / zoom) - (clientY - rect.top)
      anchor.current = { x, y }
      onZoom(next)
    },
    [zoom, onZoom],
  )

  useLayoutEffect(() => {
    const el = scrollRef.current
    const at = anchor.current
    if (!el || !at) return
    anchor.current = null
    settleAuto()
    el.scrollTo({ left: Math.max(0, at.x), top: Math.max(0, at.y), behavior: 'auto' })
  }, [layout, settleAuto])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !interactive || !onZoom) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      // The exponent turns a delta into a ratio, so the same pinch travels the
      // same proportion of the range wherever you start from. Clamped per
      // event because trackpads disagree wildly about scale — some send single
      // digits per frame, some send fifty — and an unclamped delta from the
      // latter jumps from fitted to maximum in two frames.
      const step = Math.exp(-clamp(e.deltaY, -40, 40) / 260)
      zoomAround(step, e.clientX, e.clientY)
    }
    // Not passive: the whole point is to stop the browser zooming the page.
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [interactive, onZoom, zoomAround])

  // Touch pinch: two pointers, and the ratio of the distance between them.
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const touchHandlers = interactive && onZoom
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType !== 'touch') return
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (e.pointerType !== 'touch' || !touches.current.has(e.pointerId)) return
          touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          if (touches.current.size !== 2) return
          const [a, b] = [...touches.current.values()]
          const gap = Math.hypot(a.x - b.x, a.y - b.y)
          if (pinch.current != null && pinch.current > 0)
            zoomAround(gap / pinch.current, (a.x + b.x) / 2, (a.y + b.y) / 2)
          pinch.current = gap
        },
        onPointerUp: (e: React.PointerEvent) => {
          touches.current.delete(e.pointerId)
          if (touches.current.size < 2) pinch.current = null
        },
        onPointerCancel: (e: React.PointerEvent) => {
          touches.current.delete(e.pointerId)
          if (touches.current.size < 2) pinch.current = null
        },
      }
    : {}

  if (failed)
    return (
      <div className="h-full w-full">
        <ScoreMessage tone="error" icon={<TriangleAlert size={18} />}>
          {failed}
        </ScoreMessage>
      </div>
    )

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      {...touchHandlers}
      className={`h-full w-full ${
        interactive ? 'pointer-events-auto overflow-auto overscroll-contain' : 'overflow-hidden'
      }`}
      // A pinch must reach the wheel handler rather than the browser's own
      // page zoom, and a two-finger pan must not be hijacked as a swipe.
      style={interactive ? { touchAction: 'pan-x pan-y' } : undefined}
    >
      {!layout ? (
        <ScoreMessage tone="quiet" icon={<Loader2 size={18} className="animate-spin" />}>
          Opening the score…
        </ScoreMessage>
      ) : (
        <div
          className={`relative mx-auto ${continuous ? '' : 'flex h-full items-center justify-center'}`}
          style={
            continuous
              ? { height: layout.height, width: Math.max(...layout.pages.map((p) => p.width)) }
              : // One page, centred in what the chrome leaves — the layer over
                // the video, where the insets can't be scrolled through and so
                // have to be real padding.
                { paddingTop: pad.top, paddingBottom: pad.bottom }
          }
        >
          {layout.pages.map((p) => (
            <Page
              key={p.page}
              pdf={pdf}
              page={p.page}
              scale={rasterScaleOf(p.page)}
              width={p.width}
              height={p.height}
              top={continuous ? p.top : undefined}
              draw={live.has(p.page) || !continuous}
              overlay={overlay}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One page: a white box of exactly the right shape, with the raster drawn into
 * it once it is near enough the viewport to be worth the work.
 *
 * The box exists whether or not the page has been drawn, which is what keeps
 * the scroll extent honest — and it is the box a mark or a pin is a fraction
 * *of*, so those are positioned correctly before the ink arrives.
 */
const Page = memo(function Page({
  pdf,
  page,
  scale,
  width,
  height,
  top,
  draw,
  overlay,
}: {
  pdf: LoadedPdf
  page: number
  scale: number
  width: number
  height: number
  /** Absolute offset in the stack; absent lays the page out in flow. */
  top?: number
  draw: boolean
  overlay?: (page: number, size: PageSize) => ReactNode
}) {
  const pageTarget = usePinTarget('score', page)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawnAt, setDrawnAt] = useState(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !draw || scale <= 0) return
    let alive = true
    pdf.render(page, canvas, scale).then(
      () => {
        if (alive) {
          setDrawnAt(scale)
          setFailed(false)
        }
      },
      () => alive && setFailed(true),
    )
    return () => {
      alive = false
    }
  }, [pdf, page, scale, draw])

  const size = { width, height }
  return (
    <div
      // The drop box for a pin dragged out of the inspector: the page is what
      // you aim at, and the page is what this element is.
      ref={pageTarget}
      // A sheet of paper on the reader's ground: a hairline edge and a shallow
      // shadow, the lift the design gives a raised surface — not the deep
      // halo a floating menu gets. The page is the content here, not chrome.
      className={`shrink-0 bg-white shadow-[0_1px_4px_rgb(0_0_0/0.18)] ring-1 ring-black/10 ${
        top == null ? 'relative' : 'absolute left-1/2 -translate-x-1/2'
      }`}
      style={{ width, height, ...(top == null ? {} : { top }) }}
    >
      <canvas
        ref={canvasRef}
        // Hidden until it has been drawn at the current scale, so a zoom shows
        // crisp white paper rather than the previous raster stretched.
        className={`block h-full w-full ${drawnAt > 0 ? '' : 'invisible'}`}
      />
      {failed && (
        <div className="absolute inset-0 grid place-items-center text-[11px] text-ink/50">
          This page would not draw.
        </div>
      )}
      {/* Only where the page is actually drawn. A fifty-page score would
          otherwise mount fifty mark layers and fifty pin layers for pages
          nobody can see, and re-render every one of them on each scroll. */}
      {draw && overlay?.(page, size)}
    </div>
  )
})

function ScoreMessage({
  tone,
  icon,
  children,
}: {
  tone: 'quiet' | 'error'
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center gap-2 px-6 text-center text-[12px] ${
        tone === 'error' ? 'text-danger' : 'text-white/70'
      }`}
    >
      {icon}
      <span className="max-w-[42ch]">{children}</span>
    </div>
  )
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export { MAX_ZOOM, MIN_ZOOM }
