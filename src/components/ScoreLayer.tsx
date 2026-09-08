import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  Loader2,
  Maximize2,
  Minimize2,
  TriangleAlert,
} from 'lucide-react'
import type { Annotation, ProjectScore, ScoreMark, ScoreTurn } from '../types'
import PinLayer from './PinLayer'
import ScoreMarks, { type MarkStyle, type MarkTool } from './ScoreMarks'
import ScoreToolbar from './ScoreToolbar'
import { scorePinsOn } from '../lib/overlays'
import { usePinTarget } from '../lib/pinTargets'
import { openPdf, type LoadedPdf, type PageSize } from '../lib/pdf'
import {
  DEFAULT_MARK_WEIGHT,
  DEFAULT_TURN_LEAD,
  MARK_COLORS,
  marksOnPage,
  pageAt,
  removeMark,
  scoreBytesUrl,
  upsertMark,
  type ScoreView,
} from '../lib/score'
import ScoreSync from './ScoreSync'
import { isTypingTarget } from '../lib/useHotkeys'

/**
 * The score: the printed music, drawn either as its own view of the player
 * column or as a layer over the picture.
 *
 * **Pane** is the ordinary placement and the one the score is built for — the
 * whole column, where a portrait page gets the room a 16:9 frame could never
 * give it, and where there is space at the foot for the drawing tools. It sits
 * over the player rather than replacing it: the video keeps playing behind the
 * panel, which is the point — you switch to the score to *read along*, not to
 * stop.
 *
 * **Frame** is the same layer laid over the video (the score's `overVideo`
 * switch), between the picture and the transport so the transport stays
 * reachable at full opacity. Read-only: the page is a couple of hundred pixels
 * wide there, which is no place to aim a highlighter.
 *
 * Either way the layer can go **expanded**: the same document, the same page,
 * drawn to the whole viewport through a portal. The portal matters — the panes
 * are `.glass`, and a backdrop-filter makes an ancestor the containing block
 * for `position: fixed`, so a fixed child of the pane would be trapped inside
 * it.
 *
 * The document is loaded once here and kept across every one of those moves,
 * so switching placement or expanding costs a re-render, never a re-fetch.
 *
 * Once the score carries page turns it follows the clock instead of the
 * reader — see the peek rule below.
 */
export default function ScoreLayer({
  score,
  view,
  placement = 'frame',
  reloadKey = 0,
  currentTime,
  onSeek,
  onTurns,
  transport,
  syncing = false,
  onSyncing,
  annotations,
  selectedId,
  readOnly,
  onMovePin,
  onPageChange,
  onMarks,
  canDraw = false,
}: {
  score: ProjectScore
  view: ScoreView
  /**
   * Where this instance is drawn: its own view of the player column, or a
   * layer over the video frame. Only the pane (and the expanded portal) can
   * be drawn on.
   */
  placement?: 'pane' | 'frame'
  /** Bump to re-fetch the bytes — how "Reload score" beats the caches. */
  reloadKey?: number
  /** Clip time, so the page can follow the music. Omitted: no following. */
  currentTime?: number
  onSeek?: (t: number) => void
  /** Present when the reader may retime the turns — the sync workspace. */
  onTurns?: (turns: ScoreTurn[]) => void
  /** The transport, shown under the page while syncing. */
  transport?: ReactNode
  /** Whether the sync workspace is open (owned by the host, opened from the
   *  score menu). Syncing implies expanded — there is no room otherwise. */
  syncing?: boolean
  onSyncing?: (on: boolean) => void
  /**
   * Every note, so the layer can draw the pins aimed at the *page* rather than
   * at the frame (see NoteOverlay.pinAnchor). They live inside the page box,
   * which is what makes them hold their place in the music through a rescale,
   * a refit, an expand or a scroll.
   */
  annotations?: Annotation[]
  /** The note open in the inspector — the only pin that can be dragged. */
  selectedId?: string | null
  readOnly?: boolean
  onMovePin?: (id: string, x: number, y: number) => void
  /** Reports the page on screen, so the host can stamp a new pin onto it. */
  onPageChange?: (page: number) => void
  /** Save the drawn marks. Absent means nobody here may draw. */
  onMarks?: (marks: ScoreMark[]) => void
  /** Whether to offer the drawing tools at all (pane and expanded only). */
  canDraw?: boolean
}) {
  const pdf = useScorePdf(score, reloadKey)
  const [rawPage, setPage] = useState(1)
  const [rawExpanded, setExpanded] = useState(false)
  const [lead, setLead] = useState(DEFAULT_TURN_LEAD)
  const expanded = rawExpanded || syncing

  // The drawing tools. All three are the reader's own session state, not the
  // track's: which pen you last held is about you, and saving it would make
  // opening someone's shared score hand you their highlighter.
  const [tool, setTool] = useState<MarkTool>(null)
  const [markStyle, setMarkStyle] = useState<MarkStyle>({
    color: MARK_COLORS[0],
    weight: DEFAULT_MARK_WEIGHT,
  })
  const [selectedMark, setSelectedMark] = useState<string | null>(null)
  // Drawing needs a surface big enough to aim at, so the tools are offered in
  // the pane and expanded but never in the video frame — and never while the
  // sync workspace is up, where every press is meant to be a page turn.
  const drawable = canDraw && !!onMarks && !syncing && (placement === 'pane' || expanded)

  // A shorter replacement (or a different score) must never leave the reader
  // parked on a page that no longer exists. Clamped as it is read rather than
  // corrected in an effect, so no frame ever renders the stale number.
  const pageCount = pdf.doc?.pageCount ?? 1

  // Following the music. A synced score turns its own pages — except while the
  // sync workspace is open, where the page on screen is the one being timed
  // and must not move under the person timing it.
  const followed =
    !syncing && score.turns?.length && currentTime != null
      ? pageAt(score.turns, currentTime)
      : null
  // ...and except when the reader has looked ahead. A peek remembers which
  // followed page it was taken from, so it survives exactly until the music
  // reaches the next turn and then hands control back on its own — no timer,
  // no "resume following" the reader has to remember to press.
  const [peek, setPeek] = useState<{ page: number; from: number } | null>(null)
  const peeking = followed != null && peek != null && peek.from === followed
  const page = Math.min(
    followed != null ? (peeking ? peek.page : followed) : rawPage,
    pageCount,
  )

  // Both updates are functional, deliberately: two clicks land in one render,
  // and reading the page out of this closure would make the second one repeat
  // the first instead of continuing it.
  const step = useCallback(
    (by: number) => {
      const clamp = (n: number) => Math.min(Math.max(1, n), pageCount)
      if (followed != null)
        setPeek((prev) => ({
          page: clamp((prev?.from === followed ? prev.page : followed) + by),
          from: followed,
        }))
      else setPage((p) => clamp(Math.min(p, pageCount) + by))
    },
    [pageCount, followed],
  )
  // Used by the sync workspace, where the page is always the reader's own.
  const showPage = useCallback(
    (to: number) => setPage(Math.min(Math.max(1, to), pageCount)),
    [pageCount],
  )

  /** The marks on the page in front of the reader. */
  const pageMarks = useMemo(
    () => marksOnPage(score.marks, page),
    [score.marks, page],
  )


  // What is actually armed, derived rather than reset in an effect. The tool
  // is put down whenever drawing isn't possible (the layer left the pane, a
  // sync pass started, the reader lost their edit rights) — a tool left live
  // on a surface with no toolbar would take clicks with nothing on screen to
  // explain why. And a selection is a selection *on a page*: turning past it
  // must not leave the delete button armed over a mark nobody can see.
  //
  // Derived, so the reader's tool is still in their hand when they come back
  // from the expanded view, which an effect that cleared it would have lost.
  const activeTool: MarkTool = drawable ? tool : null
  const activeMark =
    drawable && pageMarks.some((m) => m.id === selectedMark) ? selectedMark : null

  const commitMark = useCallback(
    (mark: ScoreMark) => onMarks?.(upsertMark(score.marks, mark)),
    [onMarks, score.marks],
  )
  const deleteMark = useCallback(() => {
    if (!activeMark) return
    onMarks?.(removeMark(score.marks, activeMark))
    setSelectedMark(null)
  }, [onMarks, score.marks, activeMark])

  // Expanded, the score owns the arrow keys and Escape; with a tool armed it
  // owns Escape and Delete wherever it is. Capture + preventDefault rather
  // than a bubble listener: the app's global hotkeys sit on window too, and
  // they skip an event that has already been handled (useHotkeys).
  //
  // The arrows are claimed only when expanded, deliberately. In the pane they
  // are the app's own seek keys, and a reader following the music with ← and →
  // would be startled to find them turning pages instead.
  useEffect(() => {
    if (!expanded && !drawable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // The same exemption useHotkeys makes, and for the same reason: the sync
      // panel has a text field in it, where ← and → move the caret and Escape
      // is not a way out of the workspace.
      if (isTypingTarget(e.target)) return
      if (e.key === 'Escape') {
        // Putting the pen down first: with a tool armed that is what Escape
        // most obviously undoes, and leaving the score entirely while still
        // holding a highlighter is rarely what was meant.
        if (activeTool !== null) {
          setTool(null)
          setSelectedMark(null)
        } else if (syncing) onSyncing?.(false)
        else if (expanded) setExpanded(false)
        else return
      } else if (
        (e.key === 'Delete' || e.key === 'Backspace') &&
        activeMark
      )
        deleteMark()
      else if (expanded && (e.key === 'ArrowRight' || e.key === 'PageDown')) step(1)
      else if (expanded && (e.key === 'ArrowLeft' || e.key === 'PageUp')) step(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [expanded, drawable, step, syncing, onSyncing, activeTool, activeMark, deleteMark])

  // The pins aimed at this page, under the same time-and-selection rule the
  // frame's pins follow. A score pin on another page simply isn't drawn: it is
  // a fraction of a page box that isn't on screen, and floating it over the
  // video at those coordinates would put it somewhere that means nothing.
  const scorePins = useMemo(() => {
    if (!annotations?.length || currentTime == null) return []
    return scorePinsOn(annotations, page, currentTime, selectedId)
  }, [annotations, currentTime, selectedId, page])

  // Tell the host which page is up, so a pin dropped now lands on it.
  useEffect(() => {
    onPageChange?.(page)
  }, [page, onPageChange])

  // Room the page must not be drawn into. In the frame that's the page-nav band
  // above and the floating transport below — a page fitted edge to edge would
  // hide its title and its last system under them, which on a score is exactly
  // the part you were reading. Expanded, only the band is in the way, unless
  // the transport has joined it at the foot for a sync pass.
  const pad = !expanded
    ? placement === 'pane'
      ? drawable
        ? 'pt-10 pb-24'
        : 'pt-10 pb-12'
      : 'pt-9 pb-12'
    : syncing
      ? 'pt-12 pb-14'
      : drawable
        ? 'pt-12 pb-16'
        : 'pt-12 pb-4'

  const chrome = (
    <ScoreChrome
      page={page}
      pageCount={pageCount}
      expanded={expanded}
      busy={pdf.status === 'loading'}
      peeking={peeking}
      following={followed != null}
      onStep={step}
      onFollow={() => setPeek(null)}
      onExpanded={syncing ? undefined : setExpanded}
    />
  )

  const surface =
    pdf.status === 'error' ? (
      <ScoreMessage tone="error" icon={<TriangleAlert size={18} />}>
        {pdf.message}
      </ScoreMessage>
    ) : pdf.doc ? (
      <ScoreSurface
        pdf={pdf.doc}
        page={page}
        fit={view.fit}
        pad={pad}
        // Both layers live inside the page box, which is what makes their
        // fractions hold through a rescale — the box resizes, the numbers
        // don't. Marks are painted under the pins: a pin is a callout with
        // words on it and has to stay readable over whatever is highlighted.
        overlay={(size) => (
          <>
            <ScoreMarks
              marks={pageMarks}
              page={page}
              size={size}
              tool={activeTool}
              style={markStyle}
              selectedId={activeMark}
              onSelect={setSelectedMark}
              onCommit={commitMark}
            />
            <PinLayer
              pins={scorePins}
              selectedId={selectedId}
              readOnly={readOnly}
              onMovePin={onMovePin}
              spill
            />
          </>
        )}
      />
    ) : (
      <ScoreMessage tone="quiet" icon={<Loader2 size={18} className="animate-spin" />}>
        Loading the score…
      </ScoreMessage>
    )

  // Lifted clear of the transport when there is one under it — the tools and
  // the play button are both things a hand reaches for, and stacking them
  // would put the pen where the scrub bar was a moment ago.
  const toolbar = drawable ? (
    <div
      // Above the transport, not merely beside it: the transport's gradient
      // is a tall invisible box reaching well past its controls, and at an
      // equal z-index it swallows every click aimed at the tools.
      className={`pointer-events-none absolute inset-x-0 z-30 ${
        placement === 'pane' ? 'bottom-14' : 'bottom-3'
      }`}
    >
      <ScoreToolbar
        tool={activeTool}
        onTool={setTool}
        style={markStyle}
        onStyle={setMarkStyle}
        canDelete={!!activeMark}
        onDelete={deleteMark}
      />
    </div>
  ) : null

  if (expanded) {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex animate-fade-in flex-col bg-ink/95 backdrop-blur-sm">
        <div className="relative min-h-0 flex-1">
          {surface}
          {chrome}
          {toolbar}
          {/* Syncing needs the clock and the seek bar in reach of the page
              being timed; the overlay transport pins itself to the foot of
              this box, which is exactly where it's wanted. */}
          {syncing && transport}
        </div>
        {syncing && onTurns && currentTime != null && onSeek && (
          <ScoreSync
            turns={score.turns ?? []}
            page={page}
            pageCount={pageCount}
            currentTime={currentTime}
            lead={lead}
            onLead={setLead}
            onTurns={onTurns}
            onSeek={onSeek}
            onPage={showPage}
            onClose={() => onSyncing?.(false)}
          />
        )}
      </div>,
      document.body,
    )
  }

  // The score view: the whole player column, over the player rather than
  // instead of it. The player stays mounted underneath and keeps playing —
  // unmounting it would stop a YouTube iframe dead, and you switch to the
  // score to read along with the music, not to silence it.
  if (placement === 'pane') {
    return (
      <div className="absolute inset-0 animate-fade-in overflow-hidden rounded-lg bg-black">
        {surface}
        {chrome}
        {toolbar}
        {/* Its own transport, pinned to the foot of this panel. The view
            covers the player, floating transport and all, and a score you
            can't start or scrub is a picture of music rather than a way to
            follow it. The overlay variant is the right one even on an audio
            track: it pins itself to the foot of whatever box it's in, and
            this box has a black ground for it to read against. */}
        {transport}
      </div>
    )
  }

  // Over the picture (`overVideo`): the ground is dropped entirely and the
  // *page* turned down, so the video reads through the staves and around them.
  // Dimming a black ground as well would only make both halves murky.
  //
  // Three layers share this frame, and the score is the one that moves. Note
  // covers and pins (VideoOverlays) sit at z-10 and the transport at z-20, so
  // the score paints just under the covers by default and just over them when
  // the track says so — never over the transport, whatever the setting: a
  // score you can't pause behind is not an improvement. The order is a
  // z-index rather than a position in the tree so that flipping it doesn't
  // remount the layer and re-fetch the PDF.
  return (
    <div
      // Inert except for its chrome, the same rule VideoOverlays follows: a
      // page drawn across the frame must not eat the clicks aimed at what's
      // behind it — the player's own click-to-pause catcher, and a selected
      // note's draggable pin. The exception is a width-fitted page, which is
      // taller than the frame and has to take the pointer to be scrolled.
      className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ease-instr ${
        view.onTop ? 'z-[15]' : 'z-[5]'
      }`}
      style={{ opacity: view.opacity }}
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
  overlay,
}: {
  pdf: LoadedPdf
  page: number
  fit: ScoreView['fit']
  /** Padding classes reserving room for the chrome over this surface. */
  pad: string
  /**
   * Drawn inside the page box, so it moves and scales with the page. Given
   * the page's pixel size, which the marks need: a shape stored in fractions
   * has to be turned back into pixels to be drawn without distorting it.
   */
  overlay?: (size: PageSize) => ReactNode
}) {
  const pageTarget = usePinTarget('score', page)
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
        fit === 'width'
          ? 'pointer-events-auto overflow-y-auto overflow-x-hidden'
          : 'overflow-hidden'
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
          // The page box: exactly the drawn page, and positioned, so anything
          // inside it can be placed as a percentage *of the page*. That is the
          // whole trick behind a score-anchored pin — the box is what resizes
          // when the fit changes or the window moves, and the pin's numbers
          // never do.
          <div
            // Also the drop box for a pin dragged out of the inspector: the
            // page is what you aim at, and the page is what this element is.
            ref={pageTarget}
            className="relative shrink-0"
            style={
              drawn
                ? { width: `${drawn.width}px`, height: `${drawn.height}px` }
                : { width: 0, height: 0 }
            }
          >
            <canvas
              ref={canvasRef}
              // White, always: a score is ink on paper, and the surrounding
              // theme has no say in how printed music reads.
              className="block h-full w-full bg-white shadow-[0_2px_24px_rgb(0_0_0/0.45)]"
            />
            {drawn && overlay?.(drawn)}
          </div>
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
  peeking,
  following,
  onStep,
  onFollow,
  onExpanded,
}: {
  page: number
  pageCount: number
  expanded: boolean
  busy: boolean
  /** The reader has turned away from the page the music is on. */
  peeking: boolean
  /** This score turns its own pages. */
  following: boolean
  onStep: (by: number) => void
  onFollow: () => void
  /** Absent while syncing — the workspace has its own way out. */
  onExpanded?: (v: boolean) => void
}) {
  const btn = 'btn-icon on-video press disabled:opacity-30'
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 pb-8 pt-1.5">
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
      {/* Only shown once the reader has looked away from the music's page. It
          isn't required — the peek expires at the next turn on its own — but
          without it a reader who looked ahead has no way to say "never mind"
          except waiting. */}
      {peeking && (
        <button
          type="button"
          onClick={onFollow}
          title="Back to the page the music is on"
          className="chip chip-signal press ml-1 shrink-0 font-mono text-[10px]"
        >
          <ListMusic size={11} />
          Follow
        </button>
      )}
      {!peeking && following && (
        <span
          title="This score turns its own pages — use ‹ › to look ahead"
          className="ml-1 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-white/45"
        >
          Following
        </span>
      )}
      {onExpanded && (
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
      )}
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
  // `undefined` is the "nothing decided yet" seed, distinct from the `null` a
  // score with no usable file resolves to — seeding this with `url` itself
  // would make that case match on the first render and sit on the spinner
  // forever, with the error below unreachable.
  // Reset as the URL changes, during render: an effect would paint one frame
  // of the *previous* score before the new one started loading. Everything
  // after this point sets state from an async callback, which is fine.
  const [loadingFor, setLoadingFor] = useState<string | null | undefined>(undefined)
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
