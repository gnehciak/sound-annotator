import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  TriangleAlert,
} from 'lucide-react'
import type { ProjectScore } from '../types'
import { openPdf, type LoadedPdf, type PageSize } from '../lib/pdf'
import { scoreBytesUrl, type ScoreView } from '../lib/score'

/**
 * The score, drawn over the picture.
 *
 * It sits inside the video frame between the video and the transport, so the
 * transport stays reachable with the score at full opacity — which is the
 * default ('score' mode). 'overlay' mode is the same layer turned down until
 * the picture reads through it.
 *
 * A 16:9 frame is a poor shape for a portrait page, so the layer can also go
 * **expanded**: the same document, the same page, drawn to the whole viewport
 * through a portal. The portal matters — the panes are `.glass`, and a
 * backdrop-filter makes an ancestor the containing block for `position:
 * fixed`, so a fixed child of the frame would be trapped inside the pane.
 *
 * The document is loaded once here and kept across that move, so expanding
 * costs a re-render, never a re-fetch.
 */
export default function ScoreLayer({
  score,
  view,
  reloadKey = 0,
}: {
  score: ProjectScore
  view: ScoreView
  /** Bump to re-fetch the bytes — how "Reload score" beats the caches. */
  reloadKey?: number
}) {
  const pdf = useScorePdf(score, reloadKey)
  const [rawPage, setPage] = useState(1)
  const [expanded, setExpanded] = useState(false)

  // A shorter replacement (or a different score) must never leave the reader
  // parked on a page that no longer exists. Clamped as it is read rather than
  // corrected in an effect, so no frame ever renders the stale number.
  const pageCount = pdf.doc?.pageCount ?? 1
  const page = Math.min(rawPage, pageCount)

  const step = useCallback(
    (by: number) => setPage((p) => Math.min(Math.max(1, Math.min(p, pageCount) + by), pageCount)),
    [pageCount],
  )

  // Expanded, the score owns the arrow keys and Escape. Capture + preventDefault
  // rather than a bubble listener: the app's global hotkeys sit on window too,
  // and they skip an event that has already been handled (useHotkeys).
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') setExpanded(false)
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') step(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') step(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded, step])

  // Room the page must not be drawn into. In the frame that's the page-nav band
  // above and the floating transport below — a page fitted edge to edge would
  // hide its title and its last system under them, which on a score is exactly
  // the part you were reading. Expanded, only the band is in the way.
  const pad = expanded ? 'pt-12 pb-4' : 'pt-9 pb-12'

  const chrome = (
    <ScoreChrome
      page={page}
      pageCount={pageCount}
      expanded={expanded}
      busy={pdf.status === 'loading'}
      onStep={step}
      onExpanded={setExpanded}
    />
  )

  const surface =
    pdf.status === 'error' ? (
      <ScoreMessage tone="error" icon={<TriangleAlert size={18} />}>
        {pdf.message}
      </ScoreMessage>
    ) : pdf.doc ? (
      <ScoreSurface pdf={pdf.doc} page={page} fit={view.fit} pad={pad} />
    ) : (
      <ScoreMessage tone="quiet" icon={<Loader2 size={18} className="animate-spin" />}>
        Loading the score…
      </ScoreMessage>
    )

  if (expanded) {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex animate-fade-in flex-col bg-ink/95 backdrop-blur-sm">
        <div className="relative min-h-0 flex-1">
          {surface}
          {chrome}
        </div>
      </div>,
      document.body,
    )
  }

  // The two modes differ in one thing, but not the obvious one. 'score' paints
  // an opaque ground and hides the picture — the page is what you are reading.
  // 'overlay' drops the ground entirely and turns the *page* down, so the
  // picture reads through the staves and around them; dimming a black ground
  // as well would only make both halves murky.
  return (
    <div
      className={`absolute inset-0 z-10 transition-opacity duration-200 ease-instr ${
        view.mode === 'score' ? 'bg-black' : ''
      }`}
      style={view.mode === 'overlay' ? { opacity: view.opacity } : undefined}
    >
      {surface}
      {chrome}
    </div>
  )
}

/**
 * The box an audio track's score lives in. A waveform is the picture and must
 * stay uncovered (the same rule the transport follows), so on an audio track
 * the score gets its own frame above it rather than a layer over anything —
 * shaped like the video frame so the player column keeps one silhouette
 * whatever the source is.
 *
 * The height cap is a flat 46vh rather than the `--player-max-h` the video
 * frame tracks, deliberately: that variable is measured *from* the player area
 * this box now sits inside, so tracking it would let the box's own size feed
 * back into the measurement it's derived from and oscillate. A fixed cap can't.
 */
export function ScoreFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="video-glow relative mx-auto aspect-video w-full shrink-0 overflow-hidden rounded-lg border border-line/70 bg-black"
      style={{ maxWidth: 'calc(46vh * 16 / 9)' }}
    >
      {children}
    </div>
  )
}

// ---- the drawn page -------------------------------------------------------

/**
 * The canvas, redrawn whenever the page, the fit or the box it has to fill
 * changes. Height-fit letterboxes the whole page inside the box; width-fit
 * fills the width and lets the page run taller than the box, which is what the
 * scroll container is for.
 */
function ScoreSurface({
  pdf,
  page,
  fit,
  pad,
}: {
  pdf: LoadedPdf
  page: number
  fit: ScoreView['fit']
  /** Padding classes reserving room for the chrome over this surface. */
  pad: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState<PageSize | null>(null)
  const [drawn, setDrawn] = useState<PageSize | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      // Round: a sub-pixel wobble from the surrounding flex layout would
      // otherwise re-render the page on every frame of a resize.
      setBox({ width: Math.round(width), height: Math.round(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !box || box.width < 8 || box.height < 8) return
    let alive = true
    pdf.render(page, canvas, box, fit).then(
      (size) => {
        if (alive) {
          setDrawn(size)
          setFailed(null)
        }
      },
      (e: unknown) => {
        if (alive) setFailed(e instanceof Error ? e.message : 'That page would not draw.')
      },
    )
    return () => {
      alive = false
    }
  }, [pdf, page, fit, box])

  return (
    <div
      ref={boxRef}
      // ResizeObserver reports the *content* box, so the chrome's padding is
      // subtracted from the fit for free — the page is drawn into what's left.
      className={`h-full w-full ${pad} ${
        fit === 'width' ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
      }`}
    >
      <div
        className={`flex w-full ${
          fit === 'width' ? 'min-h-full items-start' : 'h-full items-center'
        } justify-center`}
      >
        {failed ? (
          <ScoreMessage tone="error" icon={<TriangleAlert size={18} />}>
            {failed}
          </ScoreMessage>
        ) : (
          <canvas
            ref={canvasRef}
            // White, always: a score is ink on paper, and the surrounding
            // theme has no say in how printed music reads.
            className="bg-white shadow-[0_2px_24px_rgb(0_0_0/0.45)]"
            style={
              drawn
                ? { width: `${drawn.width}px`, height: `${drawn.height}px` }
                : { width: 0, height: 0 }
            }
          />
        )}
      </div>
    </div>
  )
}

// ---- chrome ---------------------------------------------------------------

/** Page nav and the expand toggle, floating at the top of the layer. */
function ScoreChrome({
  page,
  pageCount,
  expanded,
  busy,
  onStep,
  onExpanded,
}: {
  page: number
  pageCount: number
  expanded: boolean
  busy: boolean
  onStep: (by: number) => void
  onExpanded: (v: boolean) => void
}) {
  const btn = 'btn-icon on-video press disabled:opacity-30'
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 pb-8 pt-1.5">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={busy || page <= 1}
        aria-label="Previous page"
        title={expanded ? 'Previous page (←)' : 'Previous page'}
        className={btn}
      >
        <ChevronLeft size={16} />
      </button>
      <span className="min-w-[64px] text-center font-mono text-[11px] tabular-nums text-white/85">
        {busy ? '···' : `${page} / ${pageCount}`}
      </span>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={busy || page >= pageCount}
        aria-label="Next page"
        title={expanded ? 'Next page (→)' : 'Next page'}
        className={btn}
      >
        <ChevronRight size={16} />
      </button>
      <button
        type="button"
        onClick={() => onExpanded(!expanded)}
        aria-label={expanded ? 'Shrink the score' : 'Fill the screen with the score'}
        title={
          expanded
            ? 'Back to the player (Esc)'
            : 'Fill the screen — a 16:9 frame is a small window on a portrait page'
        }
        className={`${btn} ml-1`}
      >
        {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    </div>
  )
}

function ScoreMessage({
  tone,
  icon,
  children,
}: {
  tone: 'quiet' | 'error'
  icon: React.ReactNode
  children: React.ReactNode
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

// ---- loading --------------------------------------------------------------

interface PdfState {
  status: 'loading' | 'ready' | 'error'
  doc: LoadedPdf | null
  message: string
}

/**
 * Fetch the score's bytes and open them, re-running when the score changes or
 * the reader asks for a reload.
 *
 * The bytes are fetched here rather than handed to pdf.js as a URL so the
 * whole file arrives in one request — pdf.js would otherwise range-fetch it,
 * and for a Drive score every range is another trip through our own proxy —
 * and so the proxy's own JSON error ("check that it is shared with Anyone with
 * the link") reaches the reader instead of a generic parse failure.
 */
function useScorePdf(score: ProjectScore, reloadKey: number): PdfState {
  const url = scoreBytesUrl(score, reloadKey)
  const [state, setState] = useState<PdfState>({
    status: 'loading',
    doc: null,
    message: '',
  })
  // Reset as the URL changes, during render: an effect would paint one frame
  // of the *previous* score before the new one started loading. Everything
  // after this point sets state from an async callback, which is fine.
  const [loadingFor, setLoadingFor] = useState(url)
  if (loadingFor !== url) {
    setLoadingFor(url)
    setState(
      url
        ? { status: 'loading', doc: null, message: '' }
        : { status: 'error', doc: null, message: 'This score has no file.' },
    )
  }

  useEffect(() => {
    if (!url) return
    let alive = true
    let loaded: LoadedPdf | null = null
    const abort = new AbortController()

    void (async () => {
      try {
        const bytes = await fetchScore(url, abort.signal)
        const doc = await openPdf(bytes)
        loaded = doc
        if (alive) setState({ status: 'ready', doc, message: '' })
        else doc.destroy()
      } catch (e) {
        if (!alive || abort.signal.aborted) return
        setState({
          status: 'error',
          doc: null,
          message: e instanceof Error ? e.message : 'The score would not load.',
        })
      }
    })()

    return () => {
      alive = false
      abort.abort()
      loaded?.destroy()
    }
  }, [url])

  return state
}

/** The score's bytes, with our proxy's JSON complaint turned back into text. */
async function fetchScore(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(url, { signal })
  if (!res.ok) {
    const message = await res
      .json()
      .then((d: { error?: string }) => d.error)
      .catch(() => null)
    throw new Error(message ?? `The score could not be fetched (${res.status}).`)
  }
  return res.arrayBuffer()
}
