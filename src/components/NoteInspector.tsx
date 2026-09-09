import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  X,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Brackets,
  CircleHelp,
  Hash,
  BookOpen,
  ListChecks,
  Wand2,
} from 'lucide-react'
import type { Annotation } from '../types'
import { formatTime, parseTime } from '../lib/format'
import {
  blocksOf,
  textHtmlOf,
  asTextData,
  TEXT_BLOCK,
} from '../lib/noteBlocks'
import { getPlugin } from '../lib/notePlugins'
import { useSmoothProgress } from '../lib/useSmoothProgress'
import AnnotationEditor, { type AnnotationEditorHandle } from './AnnotationEditor'
import ElementsDictionary from './ElementsDictionary'
import NoteOverlayControls from './NoteOverlayControls'
import Popover from './Popover'
import type { MentionItem } from './MentionList'

interface Props {
  annotation: Annotation
  color: string
  currentTime: number
  /** Track play state + rate, so the range bar smooths between time ticks. */
  isPlaying?: boolean
  playbackRate?: number
  /** Freshly created: drop the caret into the text editor on open. */
  autoFocus?: boolean
  onFocusHandled?: () => void
  /**
   * Apply a patch to the note. `opts.mode='text'` marks a rich-text body edit
   * (kept out of the app-level undo history — the editor owns its own undo);
   * `opts.coalesceKey` groups a rapid run of edits into one undo step.
   */
  onUpdate: (
    patch: Partial<Annotation>,
    opts?: { mode?: 'text'; coalesceKey?: string },
  ) => void
  /** Cue the playhead to a time (clicking the range bar). */
  onSeek: (t: number) => void
  onSeekNote: (id: string) => void
  mentionItems: (query: string) => MentionItem[]
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
  /** False for guests — see AnnotationEditor's `allowImages`. */
  allowImages?: boolean
  /**
   * Whether this project has a video frame to draw on — the note's cover image
   * and pin controls (see NoteOverlayControls). False for audio tracks, whose
   * waveform is the picture and must stay uncovered.
   */
  allowOverlays?: boolean
  /** The score page on screen, when the track has a score (see the pin anchor
   *  in NoteOverlayControls). Absent means there is no score to pin to. */
  scorePage?: number
  /** The track has a score, but it's switched off. */
  scoreHidden?: boolean
  /**
   * Mirror of the body editor's imperative handle, so the host can write into
   * the open note from outside it — a note's context menu offering to
   * reference it in whatever note is being written (see App's
   * `insertNoteReference`). Held by the host, filled in here.
   */
  editorApiRef?: MutableRefObject<AnnotationEditorHandle | null>
}

/**
 * The single place a note is edited, in three groups split by what they act on:
 * the note's **time** (a well — the note's own transport), the note's **record**
 * (tags plus the section / question / bar chips, each one's field revealed only
 * when it's on), and what it puts **on the picture** (NoteOverlayControls) —
 * then the rich-text body and every property block.
 *
 * The note's colour and its delete button live in the host's title bar, which
 * every presentation already pays for; see PluginWindow's `leading`/`actions`.
 * Hosted in the plugin window (docked 3rd column or modal); the note row itself
 * is just a preview.
 */
export default function NoteInspector({
  annotation,
  color,
  currentTime,
  isPlaying = false,
  playbackRate = 1,
  autoFocus,
  onFocusHandled,
  onUpdate,
  onSeek,
  onSeekNote,
  mentionItems,
  uploadImage,
  allowImages = true,
  allowOverlays = false,
  scorePage,
  scoreHidden,
  editorApiRef,
}: Props) {
  const blocks = useMemo(() => blocksOf(annotation), [annotation])
  const ownApiRef = useRef<AnnotationEditorHandle | null>(null)
  const [dictOpen, setDictOpen] = useState(false)
  /** Transient: how many underlines the last "Tag underlined" press converted. */
  const [tagged, setTagged] = useState<number | null>(null)
  // One ref callback feeding two holders: this component's own (focus, the
  // dictionary's tag insertion) and the host's, when it asked for one.
  const setEditorApi = (api: AnnotationEditorHandle | null) => {
    ownApiRef.current = api
    if (editorApiRef) editorApiRef.current = api
  }

  const updateTextBlock = (blockId: string, html: string) => {
    const next = blocks.map((b) =>
      b.id === blockId ? { ...b, data: { html } } : b,
    )
    // Body text: editor owns its own undo, so keep this out of app history.
    onUpdate({ blocks: next, contentHtml: textHtmlOf(next) }, { mode: 'text' })
  }
  const updateBlockData = (blockId: string, data: unknown) => {
    // A run of edits to the same property block collapses into one undo step.
    onUpdate(
      { blocks: blocks.map((b) => (b.id === blockId ? { ...b, data } : b)) },
      { coalesceKey: `block:${blockId}` },
    )
  }
  const removeBlock = (blockId: string) =>
    onUpdate({ blocks: blocks.filter((b) => b.id !== blockId) })

  // Begin/End edits, clamped: start ∈ [0, end-1]; end ≥ start+1.
  // Rapid ±1s nudges to the same endpoint collapse into one undo step.
  const timeKey = { coalesceKey: `time:${annotation.id}` }
  const setStart = (t: number) => {
    const max =
      annotation.end != null ? annotation.end - 1 : Number.POSITIVE_INFINITY
    onUpdate({ start: Math.max(0, Math.min(max, Math.round(t))) }, timeKey)
  }
  const setEnd = (t: number) =>
    onUpdate({ end: Math.max(Math.round(t), annotation.start + 1) }, timeKey)
  // Removing the end makes this a point note, which can't be a section (a
  // section needs a span to bracket), so drop the structure flag too.
  const clearEnd = () => onUpdate({ end: undefined, structure: false })

  // The bar field is revealed by its chip. A note that already carries a bar
  // opens with it showing; switching the chip off clears the value, so what the
  // panel hides is never data.
  const [barOpen, setBarOpen] = useState(!!annotation.bar)
  const barRef = useRef<HTMLInputElement>(null)
  const toggleBar = () => {
    if (barOpen) {
      setBarOpen(false)
      if (annotation.bar) onUpdate({ bar: undefined })
    } else {
      setBarOpen(true)
      requestAnimationFrame(() => barRef.current?.focus())
    }
  }

  // Just-created note: focus the text editor so the user can type immediately.
  useEffect(() => {
    if (!autoFocus) return
    const raf = requestAnimationFrame(() => {
      ownApiRef.current?.focus()
      onFocusHandled?.()
    })
    return () => cancelAnimationFrame(raf)
  }, [autoFocus, onFocusHandled])

  // Clicking a @-mention inside the editor seeks to that note.
  const handleBodyMouseDown = (e: MouseEvent) => {
    const mention = (e.target as HTMLElement).closest('[data-type="mention"]')
    if (!mention) return
    e.preventDefault()
    const id = mention.getAttribute('data-id')
    if (id) onSeekNote(id)
  }

  const ranged = annotation.end != null

  return (
    // Keyed by note id in the host, so this remounts (and fades in) each time a
    // different note is loaded into the inspector.
    <div className="flex animate-fade-in flex-col">
      {/* ---- time: begin, a scrubber, end, and the length ---- */}
      <div className="border-b border-line/60 px-[13px] py-2.5">
        <NoteTimeBar
          start={annotation.start}
          end={annotation.end ?? null}
          currentTime={currentTime}
          isPlaying={isPlaying}
          playbackRate={playbackRate}
          color={color}
          onSeek={onSeek}
          onSetStart={setStart}
          onSetEnd={setEnd}
          onClearEnd={clearEnd}
        />
      </div>

      {/* ---- the record: what kind of note this is. The tags that label it
              live in the title bar with its colour; these are the fixed set
              of switches, each one's field revealed only once it's on. ---- */}
      <div className="flex flex-col gap-2 border-b border-line/60 px-[13px] py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <PropChip
            icon={Brackets}
            label="Section"
            on={!!annotation.structure}
            disabled={!ranged}
            title={
              ranged
                ? 'Bracketed along its span in the track overview'
                : 'Give this note an end time first — a section brackets a span, not a single moment'
            }
            onClick={() => onUpdate({ structure: !annotation.structure })}
          />
          <PropChip
            icon={CircleHelp}
            label="Question"
            on={!!annotation.question}
            title="Turns the shared view link into a listening task — students type an answer under this note and export their sheet as a PDF"
            onClick={() => onUpdate({ question: !annotation.question })}
          />
          <PropChip
            icon={Hash}
            label={annotation.bar?.trim() || 'Bar'}
            on={barOpen}
            title="Where this moment falls in the printed music — a bar number or a rehearsal mark"
            onClick={toggleBar}
          />
        </div>

        {annotation.structure && (
          <input
            value={annotation.sectionName ?? ''}
            onChange={(e) => onUpdate({ sectionName: e.target.value })}
            placeholder="Section name"
            aria-label="Section name"
            className="field"
          />
        )}

        {barOpen && (
          <input
            ref={barRef}
            value={annotation.bar ?? ''}
            onChange={(e) => {
              const v = e.target.value
              onUpdate(
                { bar: v.trim() ? v : undefined },
                { coalesceKey: `bar:${annotation.id}` },
              )
            }}
            placeholder="24 · reh. B"
            aria-label="Bar or rehearsal mark"
            className="field"
          />
        )}
      </div>

      {/* What this note puts on the video while it's on screen — a cover image
          and/or a pinned caption. Only where there's a frame to draw on. */}
      {allowOverlays && (
        <NoteOverlayControls
          annotation={annotation}
          color={color}
          onUpdate={onUpdate}
          uploadImage={uploadImage}
          scorePage={scorePage}
          scoreHidden={scoreHidden}
        />
      )}

      {/* Content blocks: text editor inline, then each property plugin's editor.
          White "page" so pasted (white-bg) screenshots blend; on dark it's = ink. */}
      <div onMouseDown={handleBodyMouseDown} className="min-h-[8rem] bg-note">
        {blocks.map((block) => {
          if (block.type === TEXT_BLOCK) {
            return (
              <AnnotationEditor
                key={block.id}
                ref={setEditorApi}
                noteId={annotation.id}
                mentionItems={mentionItems}
                uploadImage={uploadImage}
                allowImages={allowImages}
                showToolbar
                content={asTextData(block)?.html ?? ''}
                onChange={(html) => updateTextBlock(block.id, html)}
              />
            )
          }
          const plugin = getPlugin(block.type)
          if (!plugin?.Editor) return null
          const Editor = plugin.Editor
          const Icon = plugin.icon
          return (
            <div key={block.id} className="border-t border-line">
              <div className="flex items-center gap-2 px-[13px] pb-1 pt-2.5">
                <Icon size={12} className="shrink-0 text-muted" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-fg">
                  {plugin.label}
                </span>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => removeBlock(block.id)}
                  title={`Remove ${plugin.label}`}
                  aria-label={`Remove ${plugin.label}`}
                  className="btn-icon press hover:text-danger"
                >
                  <X size={13} />
                </button>
              </div>
              <Editor
                data={block.data}
                onChange={(d) => updateBlockData(block.id, d)}
                currentTime={currentTime}
              />
            </div>
          )
        })}

        {/* Three things you do *to* a note's prose rather than in it: lay out
            the concepts to answer, go looking for a word, or accept every
            underline at once. The dictionary opens as a modal — 600 words do
            not fit in a column that is already scrolling, and the note is the
            thing you want to keep looking at while you choose. */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-[13px] py-2.5">
          <button
            type="button"
            onClick={() => ownApiRef.current?.insertTemplate()}
            title="Add a bullet for each concept, each already tagged"
            className="btn-ghost btn-sm press hover:border-accent hover:text-accentink"
          >
            <ListChecks size={12} /> Template
          </button>
          <button
            type="button"
            onClick={() => setDictOpen(true)}
            title="Browse or search every word the vocabulary knows"
            className="btn-ghost btn-sm press hover:border-accent hover:text-accentink"
          >
            <BookOpen size={12} /> Dictionary
          </button>
          <button
            type="button"
            onClick={() => {
              const n = ownApiRef.current?.tagAllSuggestions() ?? 0
              setTagged(n)
              window.setTimeout(() => setTagged(null), 2600)
            }}
            title="Turn every underlined word in this note into a tag"
            className="btn-ghost btn-sm press hover:border-accent hover:text-accentink"
          >
            <Wand2 size={12} /> Tag underlined
          </button>
          {tagged != null && (
            <span className="animate-fade-in font-mono text-[10px] text-muted">
              {tagged === 0
                ? 'nothing underlined'
                : `${tagged} tagged — undo to put them back`}
            </span>
          )}
        </div>
      </div>

      {dictOpen && (
        <ElementsDictionary
          onInsert={(field, value) => ownApiRef.current?.insertProperty(field, value)}
          onClose={() => setDictOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * One of the note's kind switches, shaped as a chip so the three of them read
 * as a rail beside the tags rather than three stacked boxes. `role="switch"`
 * keeps the on/off semantics the bordered rows used to carry; `data-active`
 * draws the on state (see `.chip[data-active]` in index.css).
 */
function PropChip({
  icon: Icon,
  label,
  on,
  disabled,
  title,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string }>
  label: string
  on: boolean
  disabled?: boolean
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      title={title}
      data-active={on || undefined}
      className="chip chip-outline press max-w-[10rem]"
      style={{
        ['--hue' as string]: on
          ? 'rgb(var(--accent-ink))'
          : 'rgb(var(--text-muted))',
      }}
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

/**
 * The note's own transport: a recessed well carrying Begin, a scrubber through
 * the note, End, and the length. Clicking an endpoint opens a popover to nudge
 * it ±1s, set it to now, or type an exact time; the length's − / + move End
 * while Begin stays put, so the note keeps its cue.
 */
function NoteTimeBar({
  start,
  end,
  currentTime,
  isPlaying,
  playbackRate,
  color,
  onSeek,
  onSetStart,
  onSetEnd,
  onClearEnd,
}: {
  start: number
  end: number | null
  currentTime: number
  isPlaying: boolean
  playbackRate: number
  color: string
  onSeek: (t: number) => void
  onSetStart: (t: number) => void
  onSetEnd: (t: number) => void
  onClearEnd: () => void
}) {
  const isRange = end != null
  // Smoothed to the frame rate so the fill glides between the player's coarse
  // time ticks instead of stepping (see useSmoothProgress).
  const progress = useSmoothProgress(currentTime, {
    start,
    span: Math.max(0.001, (end ?? start) - start),
    playing: isPlaying && isRange,
    rate: playbackRate,
  })
  return (
    // Wraps rather than crushes: at the inspector's narrowest the length drops
    // to its own line instead of squeezing the scrubber to nothing.
    <div className="well flex flex-wrap items-center gap-2 px-[7px] py-[5px]">
      <TimeEndpoint
        label="Begin"
        time={start}
        currentTime={currentTime}
        onCommit={onSetStart}
        align="left"
      />
      {/* Clickable scrubber — thin like the note-card progress bar, with a taller
          transparent hit area. Clicking seeks to that point within the note. */}
      <button
        type="button"
        title="Click to seek within the note"
        aria-label="Seek within the note"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          onSeek(isRange ? start + f * (end - start) : start)
        }}
        className="group/bar relative flex min-w-[40px] flex-1 basis-[64px] items-center py-2"
      >
        <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-inset transition-colors group-hover/bar:bg-line-strong">
          {isRange ? (
            <div
              className="h-full rounded-full"
              style={{ width: `${progress * 100}%`, background: color }}
            />
          ) : (
            <div
              className="absolute left-0 top-0 h-full w-1 rounded-full"
              style={{ background: color }}
            />
          )}
        </div>
      </button>
      <TimeEndpoint
        label="End"
        time={end}
        currentTime={currentTime}
        onCommit={onSetEnd}
        onClear={isRange ? onClearEnd : undefined}
        align="right"
      />
      {isRange && (
        <LengthStepper
          start={start}
          end={end}
          onSetEnd={onSetEnd}
          onClearEnd={onClearEnd}
        />
      )}
    </div>
  )
}

/**
 * How long the note runs — the number a teacher nudges most, and the one the
 * panel never showed. − / + move End only, so trimming a note never loses the
 * moment it is cued to; ⇧ steps by 5s and holding a key repeats. Stepping below
 * a second removes the end outright, which is how a range becomes a point note
 * again (and why the Section chip goes with it).
 */
const STEP_FAST = 5
const HOLD_DELAY = 350
const HOLD_EVERY = 110

function LengthStepper({
  start,
  end,
  onSetEnd,
  onClearEnd,
}: {
  start: number
  end: number
  onSetEnd: (t: number) => void
  onClearEnd: () => void
}) {
  const timers = useRef<{ delay?: number; every?: number }>({})
  const stop = () => {
    window.clearTimeout(timers.current.delay)
    window.clearInterval(timers.current.every)
    timers.current = {}
  }
  useEffect(() => stop, [])

  /**
   * A press owns its own running end, rather than reading the note back on
   * every tick: nothing else moves the note while a key is held, and a repeat
   * that outlives the render it started in would otherwise keep stepping from
   * the same stale second.
   */
  const press = (dir: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    // The press itself is the first step, so there is no onClick to double it.
    e.preventDefault()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* the press still steps; only the repeat needs the capture */
    }
    const by = dir * (e.shiftKey ? STEP_FAST : 1)
    let value = end
    const tick = () => {
      const next = value + by
      // Below a second there is no span left to shorten: the end goes, and the
      // note is a point note again (which is why Section goes with it).
      if (next - start < 1) {
        stop()
        onClearEnd()
        return
      }
      value = next
      onSetEnd(next)
    }
    tick()
    timers.current.delay = window.setTimeout(() => {
      timers.current.every = window.setInterval(tick, HOLD_EVERY)
    }, HOLD_DELAY)
  }
  // Pointer events skip the keyboard, so Enter/Space steps once here.
  const key = (dir: number, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    const next = end + dir * (e.shiftKey ? STEP_FAST : 1)
    if (next - start < 1) onClearEnd()
    else onSetEnd(next)
  }

  const btn =
    'grid h-6 w-6 shrink-0 place-items-center text-muted transition-colors hover:bg-raised hover:text-accentink'

  return (
    <div
      role="group"
      aria-label="Note length"
      className="bevel-inset ml-auto flex shrink-0 items-center overflow-hidden rounded-full border border-line bg-inset"
    >
      <button
        type="button"
        onPointerDown={(e) => press(-1, e)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => key(-1, e)}
        title="Shorten by 1s — ⇧ for 5s, hold to run"
        aria-label="Shorten the note by one second"
        className={btn}
      >
        <Minus size={12} />
      </button>
      <span
        aria-live="polite"
        title="How long this note runs"
        className="led min-w-[44px] text-center text-[11.5px]"
      >
        {formatTime(end - start)}
      </span>
      <button
        type="button"
        onPointerDown={(e) => press(1, e)}
        onPointerUp={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => key(1, e)}
        title="Lengthen by 1s — ⇧ for 5s, hold to run"
        aria-label="Lengthen the note by one second"
        className={btn}
      >
        <Plus size={12} />
      </button>
    </div>
  )
}

/** A clickable timecode chip → popover: type an exact time, or ‹ −1s · Now · +1s ›. */
function TimeEndpoint({
  label,
  time,
  currentTime,
  onCommit,
  onClear,
  align,
}: {
  label: string
  time: number | null
  currentTime: number
  onCommit: (t: number) => void
  onClear?: () => void
  align: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  // null while not editing → the field shows the live value; a string while typing.
  const [text, setText] = useState<string | null>(null)
  const ref = useRef<HTMLButtonElement>(null)

  const base = time ?? Math.floor(currentTime)
  // An unset end names the thing it would become, rather than showing a dash.
  const display = time != null ? formatTime(time) : '+ End'
  const inputValue = text ?? (time != null ? formatTime(time) : '')

  const close = () => {
    setText(null)
    setOpen(false)
  }
  const commitText = () => {
    if (text != null) {
      const t = parseTime(text)
      if (t != null) onCommit(t)
    }
    setText(null)
  }

  const nudgeBtn =
    'btn-icon press h-7 w-7 border border-line hover:border-accent hover:bg-transparent hover:text-accentink'

  return (
    <div className="relative shrink-0">
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`${label} — click to edit`}
        aria-label={`${label} ${time != null ? display : 'not set'}`}
        className="chip chip-outline press text-[12px] normal-case tracking-[0.02em] tabular-nums"
        style={{
          ['--hue' as string]: open ? 'rgb(var(--accent-ink))' : 'rgb(var(--text))',
        }}
      >
        {display}
      </button>
      <Popover
        open={open}
        anchorRef={ref}
        onClose={close}
        width={184}
        className={`${
          align === 'right' ? 'origin-top-right' : 'origin-top-left'
        } p-2.5`}
      >
        <div className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
          {label}
        </div>
        <input
          value={inputValue}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setText(time != null ? formatTime(time) : '')}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitText()
            }
          }}
          placeholder="m:ss"
          inputMode="numeric"
          aria-label={`${label} time`}
          className="field mb-2 text-center font-mono"
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCommit(base - 1)}
            title="Nudge back 1 second"
            aria-label="Nudge back 1 second"
            className={nudgeBtn}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={() => onCommit(Math.floor(currentTime))}
            title="Set to the current time"
            className="btn-ghost press h-7 flex-1 hover:border-accent hover:text-accentink"
          >
            <Crosshair size={12} /> Now
          </button>
          <button
            type="button"
            onClick={() => onCommit(base + 1)}
            title="Nudge forward 1 second"
            aria-label="Nudge forward 1 second"
            className={nudgeBtn}
          >
            <ChevronRight size={14} />
          </button>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={() => {
              onClear()
              close()
            }}
            className="btn-ghost press mt-2 w-full border-line/60 py-1.5 hover:border-danger/60 hover:text-danger"
          >
            <X size={11} /> Remove end
          </button>
        )}
      </Popover>
    </div>
  )
}
