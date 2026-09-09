import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Trash2,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import type { Annotation, NoteQuote, ProjectScore, ScoreMark, ScoreTurn } from '../types'
import PinLayer from './PinLayer'
import QuoteFrame from './QuoteFrame'
import ScoreMarks, { type MarkStyle, type MarkTool } from './ScoreMarks'
import ScoreSurface from './ScoreSurface'
import ScoreToolbar from './ScoreToolbar'
import { quoteOn, quotesOn, scorePinsOn, type PlacedQuote } from '../lib/overlays'
import { colorForId } from '../lib/noteColors'
import { openPdf, type LoadedPdf } from '../lib/pdf'
import {
  DEFAULT_MARK_WEIGHT,
  DEFAULT_TURN_LEAD,
  MARK_COLORS,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  clampZoom,
  addTurn,
  markAt,
  marksOnPage,
  pageAt,
  removeMark,
  scoreBytesUrl,
  upsertMark,
  type ScoreView,
} from '../lib/score'
import ScoreSync from './ScoreSync'
import ContextMenu, { type ContextMenuItem } from './ContextMenu'
import { isTypingTarget } from '../lib/useHotkeys'
import { useContextMenu } from '../lib/useContextMenu'
import { pinTargetAt } from '../lib/pinTargets'
import { formatTenths, noteLabel } from '../lib/format'

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
  onQuote,
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
  /**
   * Move a pin, or place one: the page is passed when the caller knows which
   * page it landed on — dragging a pin inside its own page box doesn't change
   * it, but dropping one from the page's context menu does.
   */
  onMovePin?: (id: string, x: number, y: number, page?: number) => void
  /** Commit a moved or resized score quote, in fractions of the page box. */
  onQuote?: (id: string, quote: NoteQuote) => void
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

  /**
   * Scrolling to a page *is* turning to it. The document is one scroller now,
   * so a reader who scrolls away from the music has done exactly what the
   * ‹ › buttons used to do — and it has to mean the same thing, or a peek
   * would be undone by the next thing the mouse wheel did.
   */
  const showUserPage = useCallback(
    (to: number) => {
      if (followed != null) setPeek({ page: to, from: followed })
      else setPage(to)
    },
    [followed],
  )

  // Zoom is the reader's, not the track's — the same call as which pen is in
  // your hand. A teacher who magnifies the second flute part has said
  // something about their eyes and this screen, not about the piece.
  const [zoom, setZoom] = useState(1)
  const zoomBy = useCallback(
    (factor: number) => setZoom((z) => clampZoom(z * factor)),
    [],
  )
  // Refitting is what "back to normal" means, so it resets the zoom too:
  // leaving a 4× magnification on while switching to fit-page would show the
  // reader a corner of a page and call it a fit. Adjusted during render — the
  // shape React documents for state derived from a prop change — rather than
  // in an effect, which would paint one frame at the old magnification.
  const [zoomedFor, setZoomedFor] = useState(view.fit)
  if (zoomedFor !== view.fit) {
    setZoomedFor(view.fit)
    setZoom(1)
  }



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
  // A selection survives scrolling now — several pages are on screen at once,
  // so "still visible" is no longer the same question as "still on this page".
  // It only has to still exist.
  const activeMark =
    drawable && (score.marks ?? []).some((m) => m.id === selectedMark)
      ? selectedMark
      : null

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

  // ---- the page's context menu -------------------------------------------
  // Which page, and where on it, is answered by the pin drop-box registry
  // (lib/pinTargets) rather than by threading refs out of ScoreSurface: every
  // drawn page already registers itself there as the thing a pin is aimed at,
  // and "which page is this point on" is the same question. A right-click that
  // isn't over a page — the ground around it, the chrome — is left to the
  // browser's own menu rather than answered with an empty one.
  const menu = useContextMenu()
  const [menuOn, setMenuOn] = useState<{ page: number; x: number; y: number } | null>(
    null,
  )
  const openMenu = (e: React.MouseEvent) => {
    const drop = pinTargetAt(e.clientX, e.clientY)
    if (!drop || drop.kind !== 'score' || drop.page == null) return
    e.preventDefault()
    setMenuOn({ page: drop.page, x: drop.x, y: drop.y })
    menu.openAt(e.clientX, e.clientY)
  }

  // The pins aimed at this page, under the same time-and-selection rule the
  // frame's pins follow. A score pin on another page simply isn't drawn: it is
  // a fraction of a page box that isn't on screen, and floating it over the
  // video at those coordinates would put it somewhere that means nothing.
  const pinsOnPage = useCallback(
    (n: number) =>
      !annotations?.length || currentTime == null
        ? []
        : scorePinsOn(annotations, n, currentTime, selectedId),
    [annotations, currentTime, selectedId],
  )

  const selectedNote = annotations?.find((a) => a.id === selectedId) ?? null
  /**
   * The score quotes framed on this page, and the rule differs by who is
   * looking. Editing, it is the open note's alone: the frame is a tool for
   * aiming, and every other note's rectangle over the page being aimed at is
   * in the way of it. Reading, there is nothing to aim, so a quote joins the
   * pins on the stage under exactly their time rule — while the note is on,
   * the page shows the bars it is about, which is what quoting them was for.
   */
  const quotesOnPage = useCallback(
    (n: number): PlacedQuote[] => {
      if (!readOnly) {
        const quote = quoteOn(selectedNote, n)
        return quote && selectedNote ? [{ note: selectedNote, quote }] : []
      }
      return !annotations?.length
        ? []
        : quotesOn(annotations, n, currentTime ?? 0, selectedId)
    },
    [readOnly, selectedNote, annotations, currentTime, selectedId],
  )

  // What the page's menu offers, for the point it was opened on. Marks are
  // hit-tested here rather than by arming the select tool first — pointing at
  // a highlight and saying "not that one" is the one thing the drawing tools
  // make you set up for.
  const menuMark = menuOn
    ? markAt(marksOnPage(score.marks, menuOn.page), menuOn.x, menuOn.y)
    : null
  const menuItems: ContextMenuItem[] = []
  if (menuOn) {
    const on = menuOn
    if (onMarks && menuMark) {
      menuItems.push({
        key: 'delete-mark',
        label: 'Delete this mark',
        icon: Trash2,
        danger: true,
        onSelect: () => onMarks(removeMark(score.marks, menuMark.id)),
      })
    }
    if (onMovePin && !readOnly) {
      menuItems.push({
        key: 'pin',
        label: 'Pin the open note here',
        icon: MapPin,
        hint: selectedNote ? noteLabel(selectedNote.start, selectedNote.end) : undefined,
        disabled: !selectedNote,
        disabledTitle: 'Open a note first — the pin belongs to one',
        onSelect: () =>
          selectedNote && onMovePin(selectedNote.id, on.x, on.y, on.page),
      })
    }
    // Only in the sync workspace. Outside it a stray turn would quietly put
    // the score under the clock for everyone who opens the track — and the
    // workspace is where you can see the turns you are making. Inside it the
    // menu says something the button can't: the button always means "the next
    // page", this means the page you are pointing at.
    if (syncing && onTurns && currentTime != null) {
      menuItems.push({
        key: 'turn',
        label: `Turn to page ${on.page} here`,
        icon: ListMusic,
        hint: formatTenths(Math.max(0, currentTime - lead)),
        separated: menuItems.length > 0,
        onSelect: () =>
          onTurns(addTurn(score.turns, Math.max(0, currentTime - lead), on.page)),
      })
    }
    if (!syncing) {
      menuItems.push({
        key: 'expand',
        label: expanded ? 'Leave full screen' : 'Full screen',
        icon: expanded ? Minimize2 : Maximize2,
        separated: menuItems.length > 0,
        onSelect: () => setExpanded(!expanded),
      })
    }
  }

  // Tell the host which page is up, so a pin dropped now lands on it.
  useEffect(() => {
    onPageChange?.(page)
  }, [page, onPageChange])

  // Room the page must not be drawn into. In the frame that's the page-nav band
  // above and the floating transport below — a page fitted edge to edge would
  // hide its title and its last system under them, which on a score is exactly
  // the part you were reading. Expanded, only the band is in the way, unless
  // the transport has joined it at the foot for a sync pass.
  /**
   * Whether the transport rides at the foot of *this* layer.
   *
   * In the video frame it doesn't: the player has its own floating transport
   * there and a second one would be two play buttons on one picture. Anywhere
   * this layer covers the player — its own view, or full screen — it has to
   * carry one, because it has covered the only other one.
   */
  const footTransport = !!transport && (placement === 'pane' || expanded)

  /**
   * Room the page must not be drawn into: the page nav above, and below it
   * whatever is at the foot. A page fitted edge to edge would hide its title
   * under the one and its last system under the other, which on a score is
   * exactly the part you were reading.
   */
  const pad = syncing
    ? { top: 48, bottom: 56 }
    : placement === 'frame' && !expanded
      ? // The video's own transport floats here; leave it its band.
        { top: 36, bottom: 48 }
      : {
          top: 40,
          bottom: (footTransport ? 55 : 0) + (drawable ? 52 : 0),
        }

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
      // Over the picture the chrome is white-on-video; over the score it is
      // the app's own floating material, like every menu and popover.
      tone={placement === 'pane' || expanded ? 'panel' : 'video'}
      // Zoom is offered only where it can be used: the overlay over the video
      // is inert background, and a magnified page in a 16:9 letterbox would be
      // a corner of a stave nobody can scroll to the rest of.
      zoom={placement === 'pane' || expanded ? zoom : undefined}
      onZoom={zoomBy}
      onResetZoom={() => setZoom(1)}
    />
  )

  /**
   * What a page carries on top of its raster: the marks drawn on it and the
   * pins aimed at it, both inside the page box so their fractions hold through
   * any rescale. Marks paint under the pins — a pin is a callout with words on
   * it and has to stay readable over whatever is highlighted.
   *
   * One stable callback, deliberately: the surface memoises its pages, and an
   * inline arrow here would give every page a new prop on every render and
   * defeat that on the one path — scrolling — where it matters most.
   */
  const drawOverlay = useCallback(
    (n: number, size: { width: number; height: number }) => (
      <>
        <ScoreMarks
          marks={marksOnPage(score.marks, n)}
          page={n}
          size={size}
          tool={activeTool}
          style={markStyle}
          selectedId={activeMark}
          onSelect={setSelectedMark}
          onCommit={commitMark}
        />
        {quotesOnPage(n).map(({ note, quote }) => (
          <QuoteFrame
            key={note.id}
            quote={quote}
            color={note.color ?? colorForId(note.id)}
            readOnly={readOnly}
            onChange={onQuote && ((q) => onQuote(note.id, q))}
          />
        ))}
        <PinLayer
          pins={pinsOnPage(n)}
          selectedId={selectedId}
          readOnly={readOnly}
          onMovePin={onMovePin}
          spill
        />
      </>
    ),
    [
      score.marks,
      activeTool,
      markStyle,
      activeMark,
      commitMark,
      pinsOnPage,
      quotesOnPage,
      selectedId,
      readOnly,
      onMovePin,
      onQuote,
    ],
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
        zoom={zoom}
        pad={pad}
        // The stack is the reading surface; over the video the layer is inert
        // background with no room to scroll, so it stays one fitted page.
        continuous={placement === 'pane' || expanded}
        interactive={placement === 'pane' || expanded}
        onUserPage={showUserPage}
        onZoom={setZoom}
        // Both layers live inside the page box, which is what makes their
        // fractions hold through a rescale — the box resizes, the numbers
        // don't. Marks are painted under the pins: a pin is a callout with
        // words on it and has to stay readable over whatever is highlighted.
        // Every visible page draws its own, not just the one being followed.
        overlay={drawOverlay}
      />
    ) : (
      <ScoreMessage tone="quiet" icon={<Loader2 size={18} className="animate-spin" />}>
        Loading the score…
      </ScoreMessage>
    )

  // Lifted clear of the transport when there is one under it — the tools and
  // the play button are both things a hand reaches for, and stacking them
  // would put the pen where the scrub bar was a moment ago.
  const pageMenu = (
    <ContextMenu
      point={menu.point}
      items={menuItems}
      onClose={menu.close}
      label={menuOn ? `Page ${menuOn.page} of the score` : 'Score'}
    />
  )

  const toolbar = drawable ? (
    <div
      // Floating, unlike the two strips that bracket the view: the tools are
      // the thing in your hand, not the panel's furniture, so the pill is only
      // as wide as they are and the music shows either side of it. Inert
      // outside the pill for the same reason — the page beside it is still the
      // page. Above the transport in the stacking order because the
      // transport's box reaches past its controls and would otherwise swallow
      // every click aimed at the tools.
      className={`pointer-events-none absolute inset-x-0 z-30 ${
        footTransport ? 'bottom-16' : 'bottom-3'
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
        <div className="relative min-h-0 flex-1" onContextMenu={openMenu}>
          {surface}
          {chrome}
          {toolbar}
          {pageMenu}
          {/* Full screen is the score with more room, not a stripped-down
              version of it: the tools, the pins and the transport all come
              along. The overlay transport pins itself to the foot of this box,
              which is where it's wanted both for reading and for timing a
              sync pass against the page on screen. */}
          {footTransport && transport}
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
      <div
        className="absolute inset-0 animate-fade-in overflow-hidden bg-ink"
        onContextMenu={openMenu}
      >
        {surface}
        {chrome}
        {toolbar}
        {pageMenu}
        {/* Its own transport, pinned to the foot of this panel. The view
            covers the player, floating transport and all, and a score you
            can't start or scrub is a picture of music rather than a way to
            follow it. The overlay variant is the right one even on an audio
            track: it pins itself to the foot of whatever box it's in, and
            this box has a black ground for it to read against. */}
        {footTransport && transport}
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
  tone,
  zoom,
  onZoom,
  onResetZoom,
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
  /** What this chrome floats over: the picture, or the score's own ground. */
  tone: 'video' | 'panel'
  /** The current zoom, or absent where zooming isn't offered. */
  zoom?: number
  onZoom: (factor: number) => void
  onResetZoom: () => void
}) {
  // On the picture: white glyphs standing on a gradient that fades into the
  // frame, because what is behind is anything at all. On the score: the app's
  // own floating material — a glass pill, theme-aware glyphs — because what is
  // behind is a page, and a black band across it would read as damage.
  const onVideo = tone === 'video'
  const btn = `btn-icon press disabled:opacity-30 ${onVideo ? 'on-video' : ''}`
  return (
    <div
      className={
        onVideo
          ? 'pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 pb-8 pt-1.5'
          : 'glass-strip pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center justify-center gap-1 border-b border-line/70 px-2 py-1.5'
      }
    >
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
      <span
        className={`min-w-[64px] text-center font-mono text-[11px] tabular-nums ${
          onVideo ? 'text-white/85' : 'text-fg'
        }`}
      >
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
          className={`ml-1 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] ${
            onVideo ? 'text-white/45' : 'text-muted'
          }`}
        >
          Following
        </span>
      )}
      {/* Zoom. The buttons are the discoverable half — a pinch is the one
          most readers will actually use, and nothing on screen advertises
          that a pinch works. The readout doubles as "put it back". */}
      {zoom != null && (
        <span className="ml-1 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onZoom(1 / ZOOM_STEP)}
            disabled={zoom <= MIN_ZOOM + 0.001}
            aria-label="Zoom out"
            title="Zoom out — or pinch"
            className={btn}
          >
            <ZoomOut size={15} />
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            disabled={Math.abs(zoom - 1) < 0.001}
            aria-label="Back to the fitted size"
            title="Back to the fitted size"
            className={`press min-w-[42px] rounded font-mono text-[10px] tabular-nums disabled:opacity-40 ${
              onVideo ? 'text-white/70 hover:text-white' : 'text-muted hover:text-fg'
            }`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => onZoom(ZOOM_STEP)}
            disabled={zoom >= MAX_ZOOM - 0.001}
            aria-label="Zoom in"
            title="Zoom in — or pinch"
            className={btn}
          >
            <ZoomIn size={15} />
          </button>
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
