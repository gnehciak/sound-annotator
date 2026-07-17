import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronDown, ChevronUp, Eraser, Flag, MousePointer2 } from 'lucide-react'
import type { Annotation, ChordStamp, ProjectSettings } from '../../types'
import {
  MAX_BPM,
  MIN_BPM,
  barBeatOf,
  beatAt,
  buildChordEvents,
  chordWindow,
  makeGrid,
  paintStamps,
  sectionSpans,
  tapBpm,
  timeOfBeat,
  type BeatGrid,
  type ChordEvent,
  type SectionSpan,
} from '../../lib/chords'
import { formatTime } from '../../lib/format'
import { useSmoothProgress } from '../../lib/useSmoothProgress'
import TitleBar from '../TitleBar'
import ChordDiagram from './ChordDiagram'

/**
 * The chords player — the structure board's play-along band. Reads the
 * project's beat grid (bpm / beats-per-bar / beat-1 offset, in settings) and
 * every section's painted chord stamps, and renders:
 *
 *   · a diagram rail: the sounding chord plus the next changes, as guitar
 *     chord boxes (the current one carries the accent underline — the one
 *     signal-colored mark, per Signal-Is-Now);
 *   · a paint bar (edit mode): a Seek/Erase tool pair, the song's chord
 *     vocabulary as armable chips (seeded with the open-position staples on
 *     an empty song), a field to add any symbol, and a duration switch in
 *     beats;
 *   · a beat lane: one square per beat gliding under a fixed playhead,
 *     bar ticks between bars, chord labels pinned where each stamp lands.
 *     With the Seek tool (or read-only) the lane scrubs; with a chord armed,
 *     a click stamps it for the chosen duration and a drag stretches it —
 *     always clipped to the section under the gesture, since stamps belong
 *     to sections. Esc returns to Seek; Enter stamps at the playhead.
 *     Arrows nudge by beat, up/down by bar when the lane has focus.
 *
 * Tempo lives in project settings (owner-only writes — the API clips
 * settings from link editors), so those controls follow `canEditTempo`;
 * painting edits the sections' annotations and follows `readOnly`. Each
 * paint gesture commits once, as its own undo step.
 */

interface Props {
  /** The project's sections (all of its annotations, in any order). */
  sections: Annotation[]
  settings: ProjectSettings | undefined
  duration: number
  currentTime: number
  isPlaying: boolean
  playbackRate: number
  readOnly: boolean
  /** Whether tempo settings may be edited (owner with the lock, not a viewer). */
  canEditTempo: boolean
  onSeek: (t: number) => void
  onPatchSettings: (patch: Partial<ProjectSettings>) => void
  /** Persist one section's repainted chord track. */
  onUpdateChords: (id: string, chordEvents: ChordStamp[]) => void
}

/** The paint bar's armed tool: scrub, stamp a chord, or erase. */
type Armed = { kind: 'chord'; name: string } | { kind: 'erase' } | null

/** Chip seed for a song with no chords yet — the open-position staples. */
const STARTER_CHORDS = ['C', 'G', 'Am', 'F', 'D', 'Em', 'E', 'A']

// Beat-lane geometry (px): square, gap, and their stride.
const SQ = 40
const GAP = 6
const STRIDE = SQ + GAP

const clamp = (x: number, lo: number, hi: number) =>
  Math.min(Math.max(x, lo), hi)

export default function ChordsPlayer({
  sections,
  settings,
  duration,
  currentTime,
  isPlaying,
  playbackRate,
  readOnly,
  canEditTempo,
  onSeek,
  onPatchSettings,
  onUpdateChords,
}: Props) {
  const [open, setOpen] = useState(() => settings?.chordsOpen ?? true)
  const [armed, setArmed] = useState<Armed>(null)
  const [dur, setDur] = useState(() => settings?.beatsPerBar ?? 4)

  const grid = useMemo(
    () =>
      settings?.bpm
        ? makeGrid(settings.bpm, settings.beatsPerBar, settings.beatOffset)
        : null,
    [settings?.bpm, settings?.beatsPerBar, settings?.beatOffset],
  )
  const events = useMemo(
    () => (grid ? buildChordEvents(sections, grid) : []),
    [sections, grid],
  )
  const spans = useMemo(
    () => (grid ? sectionSpans(sections, grid) : []),
    [sections, grid],
  )
  // The song's chord vocabulary, in order of first use — the chip strip.
  const songChords = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const e of events) {
      if (seen.has(e.name)) continue
      seen.add(e.name)
      out.push(e.name)
    }
    return out
  }, [events])

  /** Commit one paint gesture: repaint the target section's stamps. */
  const applyPaint = useCallback(
    (spanId: string, b: number, d: number) => {
      if (!armed) return
      const sec = sections.find((s) => s.id === spanId)
      if (!sec) return
      onUpdateChords(
        spanId,
        paintStamps(
          sec.chordEvents,
          b,
          d,
          armed.kind === 'chord' ? armed.name : null,
        ),
      )
    },
    [armed, sections, onUpdateChords],
  )
  // One smooth clock drives the whole band (the lane's glide and the rail's
  // handoff). Folded, the rate-0 trick parks the rAF loop entirely.
  const span = Math.max(duration, 1)
  const progress = useSmoothProgress(currentTime, {
    start: 0,
    span,
    playing: isPlaying,
    rate: open && grid ? playbackRate : 0,
  })
  const t = progress * span
  const beatF = grid ? beatAt(grid, t) : 0

  const readout = grid
    ? (() => {
        const { bar, beat } = barBeatOf(grid, currentTime)
        return `bar ${bar} · ${beat}`
      })()
    : undefined

  const setBpm = useCallback(
    (bpm: number) => onPatchSettings({ bpm }),
    [onPatchSettings],
  )

  const foldBtn = (
    <button
      type="button"
      onClick={() => {
        const next = !open
        setOpen(next)
        onPatchSettings({ chordsOpen: next })
      }}
      title={open ? 'Fold the chords player' : 'Show the chords player'}
      aria-expanded={open}
      className="press grid h-[24px] w-[24px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
    >
      {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  )

  const headerActions = (
    <div className="flex min-w-0 items-center gap-2">
      {open && grid && canEditTempo && (
        <div className="flex items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]">
          <label
            className="flex h-[24px] items-center gap-1 pl-1.5"
            title="Tempo in beats per minute — ↑/↓ nudge, Shift ×5"
          >
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted">
              bpm
            </span>
            <BpmField bpm={settings?.bpm} onCommit={setBpm} />
          </label>
          <TapButton compact onBpm={setBpm} />
          <BeatsSelect
            value={grid.beatsPerBar}
            onChange={(n) => onPatchSettings({ beatsPerBar: n })}
          />
          <button
            type="button"
            onClick={() =>
              onPatchSettings({
                beatOffset: Math.max(0, Math.round(currentTime * 1000) / 1000),
              })
            }
            title="Set beat 1 at the playhead — pause on the first downbeat, then press"
            className="press flex h-[24px] items-center gap-1 rounded px-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-muted transition-colors hover:text-fg"
          >
            <Flag size={11} />
            <span className="hidden lg:inline">Beat 1</span>
          </button>
        </div>
      )}
      {foldBtn}
    </div>
  )

  return (
    <section
      aria-label="Chords player"
      className="shrink-0 border-t border-line bg-panel"
      onKeyDown={(e) => {
        // Esc anywhere in the band lowers the brush back to the Seek tool.
        if (e.key === 'Escape' && armed) {
          e.stopPropagation()
          setArmed(null)
        }
      }}
    >
      <TitleBar left="Chords" right={readout} actions={headerActions} />
      {open && (
        <div className="animate-fade-in">
          {!grid ? (
            <TempoSetup
              canEdit={canEditTempo}
              settings={settings}
              onPatch={onPatchSettings}
            />
          ) : (
            <>
              {events.length > 0 ? (
                <DiagramRail events={events} beatF={beatF} onSeek={onSeek} />
              ) : (
                !readOnly && (
                  <p className="px-4 pb-1 pt-3 text-center text-[12px] text-muted">
                    {spans.length === 0
                      ? 'Draw sections on the timeline below first — chords live inside them.'
                      : 'Arm a chord below, then click the beat lane to place it — drag to stretch it across beats.'}
                  </p>
                )
              )}
              {!readOnly && (
                <PaintBar
                  armed={armed}
                  onArm={setArmed}
                  dur={dur}
                  onDur={setDur}
                  beatsPerBar={grid.beatsPerBar}
                  songChords={songChords}
                />
              )}
              <BeatLane
                grid={grid}
                events={events}
                beatF={beatF}
                duration={duration}
                currentTime={currentTime}
                onSeek={onSeek}
                paint={
                  !readOnly && armed
                    ? {
                        name: armed.kind === 'chord' ? armed.name : null,
                        dur,
                      }
                    : null
                }
                spans={spans}
                onPaint={applyPaint}
              />
            </>
          )}
        </div>
      )}
    </section>
  )
}

// ---- the paint bar ----------------------------------------------------------

/**
 * The lane's toolbox: Seek (the resting tool) and Erase, the song's chords
 * as armable chips, a field that arms anything you can name, and the stamp
 * length in beats. Armed state follows the board's active-tool treatment;
 * a second click on the armed chip lowers it again.
 */
function PaintBar({
  armed,
  onArm,
  dur,
  onDur,
  beatsPerBar,
  songChords,
}: {
  armed: Armed
  onArm: (a: Armed) => void
  dur: number
  onDur: (d: number) => void
  beatsPerBar: number
  songChords: string[]
}) {
  const [draft, setDraft] = useState('')

  // Song vocabulary first (plus whatever is armed but not yet painted),
  // topped up with the starters so a fresh song begins one click away.
  const chips = useMemo(() => {
    const out = [...songChords]
    if (armed?.kind === 'chord' && !out.includes(armed.name))
      out.push(armed.name)
    for (const c of STARTER_CHORDS) {
      if (out.length >= 10) break
      if (!out.includes(c)) out.push(c)
    }
    return out
  }, [songChords, armed])

  const durations = useMemo(
    () =>
      [...new Set([1, 2, beatsPerBar, beatsPerBar * 2])].sort((a, b) => a - b),
    [beatsPerBar],
  )

  const toolCls = (active: boolean, danger = false) =>
    `press flex h-[24px] shrink-0 items-center gap-1.5 rounded px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors duration-150 ${
      active
        ? `bg-raised ${danger ? 'text-danger' : 'text-accentink'}`
        : 'text-muted hover:text-fg'
    }`

  return (
    <div className="flex min-w-0 items-center gap-2 px-3.5 pb-1.5 pt-1">
      <div
        role="group"
        aria-label="Lane tool"
        className="flex shrink-0 items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]"
      >
        <button
          type="button"
          onClick={() => onArm(null)}
          aria-pressed={armed === null}
          title="Seek tool — click or drag the lane to move the playhead (Esc)"
          className={toolCls(armed === null)}
        >
          <MousePointer2 size={12} />
          <span className="hidden lg:inline">Seek</span>
        </button>
        <button
          type="button"
          onClick={() =>
            onArm(armed?.kind === 'erase' ? null : { kind: 'erase' })
          }
          aria-pressed={armed?.kind === 'erase'}
          title="Erase — click or drag across stamped beats to clear them"
          className={toolCls(armed?.kind === 'erase', true)}
        >
          <Eraser size={12} />
          <span className="hidden lg:inline">Erase</span>
        </button>
      </div>

      <div
        role="group"
        aria-label="Chords to paint"
        className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-0.5"
      >
        {chips.map((name) => {
          const active = armed?.kind === 'chord' && armed.name === name
          return (
            <button
              key={name}
              type="button"
              onClick={() => onArm(active ? null : { kind: 'chord', name })}
              aria-pressed={active}
              title={
                active
                  ? `${name} armed — click the lane to place it (Esc to put it down)`
                  : `Arm ${name} for painting`
              }
              className={`press shrink-0 whitespace-nowrap rounded-sm border px-2 py-[3px] font-mono text-[11px] font-semibold transition-colors ${
                active
                  ? 'border-line-strong bg-raised text-accentink'
                  : 'border-line text-fg hover:border-line-strong'
              }`}
            >
              {name}
            </button>
          )
        })}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const name = draft.trim()
            if (!name) return
            onArm({ kind: 'chord', name })
            setDraft('')
          }}
          placeholder="Add chord…"
          aria-label="Add a chord to paint — type a symbol and press Enter"
          title="Type any chord symbol (F#m7, Bb, Dsus4…) and press Enter to arm it"
          spellCheck={false}
          className="bevel-inset h-[24px] w-24 shrink-0 rounded border border-line bg-inset px-2 font-mono text-[11px] text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent"
        />
      </div>

      <div
        role="group"
        aria-label="Stamp length in beats"
        title="How many beats a click paints — drag on the lane for any other length"
        className="flex shrink-0 items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]"
      >
        {durations.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onDur(n)}
            aria-pressed={dur === n}
            className={`press h-[24px] min-w-[26px] rounded px-1.5 font-mono text-[10.5px] font-semibold tabular-nums transition-colors ${
              dur === n ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
            }`}
          >
            {n}
          </button>
        ))}
        <span className="pr-1.5 font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-muted">
          beats
        </span>
      </div>
    </div>
  )
}

// ---- tempo controls --------------------------------------------------------

/** Committed-draft BPM field: Enter/blur commits, Esc cancels, ↑↓ nudge. */
function BpmField({
  bpm,
  onCommit,
  size = 'sm',
}: {
  bpm?: number
  onCommit: (b: number) => void
  size?: 'sm' | 'lg'
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const skipRef = useRef(false)
  const parse = (s: string): number | null => {
    const n = Number(s.trim())
    return Number.isFinite(n) && n > 0
      ? clamp(Math.round(n), MIN_BPM, MAX_BPM)
      : null
  }
  return (
    <input
      inputMode="numeric"
      value={draft ?? (bpm != null ? String(bpm) : '')}
      placeholder="120"
      onFocus={(e) => {
        setDraft(bpm != null ? String(bpm) : '')
        e.currentTarget.select()
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
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const base = parse(draft ?? '') ?? bpm ?? 120
          const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1)
          const next = clamp(base + step, MIN_BPM, MAX_BPM)
          setDraft(String(next))
          onCommit(next)
        }
      }}
      onBlur={() => {
        if (!skipRef.current && draft != null) {
          const parsed = parse(draft)
          if (parsed != null) onCommit(parsed)
        }
        skipRef.current = false
        setDraft(null)
      }}
      aria-label="Tempo in beats per minute"
      className={
        size === 'lg'
          ? 'bevel-inset w-[72px] rounded border border-line bg-inset px-2 py-[6px] text-center font-mono text-[15px] tabular-nums text-fg outline-none transition-colors placeholder:text-muted/60 focus:border-accent'
          : 'w-[36px] bg-transparent text-center font-mono text-[11px] tabular-nums text-fg outline-none placeholder:text-muted/60'
      }
    />
  )
}

/**
 * Tap tempo. Compact (header) commits on every tap — the BPM field reads it
 * back live. Large (setup state) shows the running figure beside the key and
 * commits only after the tapping pauses, so the panel doesn't rebuild itself
 * mid-gesture.
 */
function TapButton({
  compact,
  onBpm,
}: {
  compact?: boolean
  onBpm: (b: number) => void
}) {
  const taps = useRef<number[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [live, setLive] = useState<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const tap = () => {
    const now = performance.now()
    const last = taps.current[taps.current.length - 1]
    if (last != null && now - last > 2200) taps.current = []
    taps.current = [...taps.current.slice(-8), now]
    const b = tapBpm(taps.current)
    if (b == null) return
    if (compact) {
      onBpm(b)
      return
    }
    setLive(b)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      onBpm(b)
      setLive(null)
      taps.current = []
    }, 1200)
  }
  if (compact) {
    return (
      <button
        type="button"
        onClick={tap}
        title="Tap the beat to set the tempo"
        className="press h-[24px] rounded px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted transition-colors hover:text-fg"
      >
        Tap
      </button>
    )
  }
  return (
    <span className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={tap}
        title="Tap the beat to set the tempo"
        className="press bevel-raised rounded bg-accent px-4 py-[8px] text-[13px] font-bold text-onaccent hover:brightness-110"
      >
        Tap tempo
      </button>
      <span
        aria-live="polite"
        className="led w-[64px] text-[15px] font-medium leading-none"
      >
        {live != null ? `♩ ${live}` : '♩ ––'}
      </span>
    </span>
  )
}

/** Meter select — beats per bar, shown as a signature over 4. */
function BeatsSelect({
  value,
  onChange,
  size = 'sm',
}: {
  value: number
  onChange: (n: number) => void
  size?: 'sm' | 'lg'
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Meter — beats per bar"
        title="Meter — beats per bar"
        className={`cursor-pointer appearance-none bg-transparent font-mono text-fg outline-none ${
          size === 'lg'
            ? 'bevel-inset rounded border border-line bg-inset py-[7px] pl-2.5 pr-6 text-[13px] focus:border-accent'
            : 'h-[24px] rounded pl-1.5 pr-5 text-[10.5px] hover:bg-raised'
        }`}
      >
        {[2, 3, 4, 5, 6, 7].map((n) => (
          <option key={n} value={n}>
            {n}/4
          </option>
        ))}
      </select>
      <ChevronDown
        size={9}
        aria-hidden
        className={`pointer-events-none absolute text-muted ${
          size === 'lg' ? 'right-2' : 'right-1'
        }`}
      />
    </span>
  )
}

/** First-run state: no tempo yet — the one number the whole band needs. */
function TempoSetup({
  canEdit,
  settings,
  onPatch,
}: {
  canEdit: boolean
  settings: ProjectSettings | undefined
  onPatch: (patch: Partial<ProjectSettings>) => void
}) {
  if (!canEdit) {
    return (
      <p className="px-6 py-6 text-center text-[12.5px] text-muted">
        No tempo set for this track yet.
      </p>
    )
  }
  return (
    <div className="flex flex-col items-center gap-3.5 px-6 py-6">
      <p className="max-w-[52ch] text-center text-[12.5px] leading-relaxed text-muted">
        Set the tempo to light the beat lane — type the BPM if you know it,
        or tap along while the track plays.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <label className="flex items-center gap-1.5" title="Tempo in beats per minute">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            bpm
          </span>
          <BpmField size="lg" bpm={settings?.bpm} onCommit={(bpm) => onPatch({ bpm })} />
        </label>
        <BeatsSelect
          size="lg"
          value={settings?.beatsPerBar ?? 4}
          onChange={(n) => onPatch({ beatsPerBar: n })}
        />
        <TapButton onBpm={(bpm) => onPatch({ bpm })} />
      </div>
    </div>
  )
}

// ---- diagram rail ----------------------------------------------------------

/** The sounding chord plus the next changes, as clickable chord boxes. */
function DiagramRail({
  events,
  beatF,
  onSeek,
}: {
  events: ChordEvent[]
  beatF: number
  onSeek: (t: number) => void
}) {
  const [width, setWidth] = useState(0)
  const roRef = useRef<ResizeObserver | null>(null)
  const setEl = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    roRef.current = new ResizeObserver(update)
    roRef.current.observe(el)
  }, [])

  const count = clamp(Math.floor((width + 16) / 124), 2, 5)
  const windowed = chordWindow(events, beatF, count)

  return (
    <div
      ref={setEl}
      className="flex items-start justify-center gap-4 px-4 pb-1 pt-3"
    >
      {windowed.map(({ event, current }) => (
        <button
          key={`${event.sectionId}:${event.startBeat}`}
          type="button"
          onClick={() => onSeek(event.start)}
          title={
            (event.chord && !event.chord.exact
              ? `${event.name} — showing the nearest shape · `
              : '') + `Play from ${formatTime(event.start)}`
          }
          className={`press w-[104px] shrink-0 rounded-md px-1 pb-1 pt-1.5 outline-none transition-opacity duration-300 focus-visible:ring-1 focus-visible:ring-accentink ${
            current ? '' : 'opacity-55 hover:opacity-80'
          }`}
        >
          <ChordDiagram name={event.name} shape={event.shape} />
          <span
            aria-hidden
            className={`mx-auto mt-1 block h-[3px] w-9 rounded-full ${
              current ? 'bg-accent' : 'bg-transparent'
            }`}
          />
        </button>
      ))}
    </div>
  )
}

// ---- beat lane -------------------------------------------------------------

const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * One square per beat gliding under a fixed accent playhead — the lane owns
 * continuous time the way the board's timeline owns the song's shape. Chord
 * labels pin to their change square and span their event; bar ticks sit in
 * the gaps between bars.
 *
 * Two pointer modes. Seeking (`paint` null): click snaps the playhead to a
 * beat, dragging scrubs. Painting (`paint` armed from the bar above): a
 * hover ghost previews the stamp, a click paints `paint.dur` beats, a drag
 * paints exactly the dragged range — clipped to the section under the
 * gesture's start, and committed once on release. Enter paints at the
 * playhead, so the keyboard path can stamp too.
 */
function BeatLane({
  grid,
  events,
  beatF,
  duration,
  currentTime,
  onSeek,
  paint,
  spans,
  onPaint,
}: {
  grid: BeatGrid
  events: ChordEvent[]
  beatF: number
  duration: number
  currentTime: number
  onSeek: (t: number) => void
  /** Armed brush (name null = eraser), or null when the lane seeks. */
  paint: { name: string | null; dur: number } | null
  spans: SectionSpan[]
  /** Commit a gesture: section id + section-relative start/length in beats. */
  onPaint: (spanId: string, b: number, d: number) => void
}) {
  const [width, setWidth] = useState(0)
  const laneRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const setEl = useCallback((el: HTMLDivElement | null) => {
    laneRef.current = el
    roRef.current?.disconnect()
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    roRef.current = new ResizeObserver(update)
    roRef.current.observe(el)
  }, [])

  // Paint gesture state. Hover previews; drag owns the in-flight stroke.
  const [hoverBeat, setHoverBeat] = useState<number | null>(null)
  const [drag, setDrag] = useState<{
    span: SectionSpan
    anchorBeat: number
    curBeat: number
    moved: boolean
  } | null>(null)

  // The playhead parks at ~22% and the track glides beneath it.
  const anchor = clamp(width * 0.22, 48, 240)
  const tx = anchor - beatF * STRIDE

  const curBeat = Math.floor(beatF)
  const minBeat = Math.floor(beatAt(grid, 0))
  const maxBeat =
    duration > 0 ? Math.ceil(beatAt(grid, duration)) : curBeat + 64
  const i0 = Math.max(Math.floor(-tx / STRIDE) - 1, minBeat)
  const i1 = Math.min(Math.ceil((-tx + width) / STRIDE) + 1, maxBeat)

  const beats: React.ReactNode[] = []
  for (let i = i0; i < i1; i++) {
    const isCur = i === curBeat
    const isBarStart = mod(i, grid.beatsPerBar) === 0
    beats.push(
      <span
        key={i}
        aria-hidden
        className={`absolute inset-y-2 rounded-[4px] border ${
          isCur
            ? 'border-accent bg-accent/20'
            : i < curBeat
              ? 'border-line opacity-40'
              : 'border-line'
        } ${i < 0 ? 'opacity-25' : ''}`}
        style={{ left: i * STRIDE, width: SQ }}
      />,
    )
    if (isBarStart && i >= 0 && i > i0)
      beats.push(
        <span
          key={`t${i}`}
          aria-hidden
          className="absolute inset-y-[9px] w-[2px] rounded-full bg-line-strong/80"
          style={{ left: i * STRIDE - GAP / 2 - 1 }}
        />,
      )
  }

  const labels = events.filter((e) => e.endBeat > i0 && e.startBeat < i1)

  const beatOfClient = (clientX: number) => {
    const rect = laneRef.current?.getBoundingClientRect()
    if (!rect) return null
    return (clientX - rect.left - tx) / STRIDE
  }

  const seekAtClient = (clientX: number, snap: boolean) => {
    const beat = beatOfClient(clientX)
    if (beat == null) return
    const target = timeOfBeat(grid, snap ? Math.floor(beat) : beat)
    onSeek(clamp(target, 0, duration > 0 ? duration : target))
  }

  const spanAt = (b: number) =>
    spans.find((sp) => b >= sp.b0 && b < sp.b1) ?? null

  /** The stroke a gesture paints: click = armed length, drag = exact range —
   *  clipped to the gesture's section. Null while nothing would land. */
  const strokeOf = (
    span: SectionSpan,
    anchorB: number,
    curB: number,
    moved: boolean,
  ): { s: number; e: number } | null => {
    const s = moved ? Math.min(anchorB, curB) : anchorB
    const e = moved
      ? Math.max(anchorB, curB) + 1
      : anchorB + (paint?.dur ?? 1)
    const cs = Math.max(s, span.b0)
    const ce = Math.min(e, span.b1)
    return ce > cs ? { s: cs, e: ce } : null
  }

  const ghost = drag
    ? strokeOf(drag.span, drag.anchorBeat, drag.curBeat, drag.moved)
    : paint && hoverBeat != null
      ? (() => {
          const sp = spanAt(hoverBeat)
          return sp ? strokeOf(sp, hoverBeat, hoverBeat, false) : null
        })()
      : null

  const { bar, beat } = barBeatOf(grid, currentTime)
  const laneLabel = paint
    ? `Beat lane — click to place ${
        paint.name ?? 'an eraser stroke'
      } for ${paint.dur} ${paint.dur === 1 ? 'beat' : 'beats'}, drag to stretch; Enter places at the playhead; Esc returns to seeking`
    : 'Beat lane — click a beat to play from it'

  return (
    <div className="px-3.5 pb-3 pt-1">
      <div
        ref={setEl}
        role="slider"
        tabIndex={0}
        aria-label={laneLabel}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, Math.round(duration))}
        aria-valuenow={clamp(Math.round(currentTime), 0, Math.max(0, Math.round(duration)))}
        aria-valuetext={`Bar ${bar}, beat ${beat} — ${formatTime(currentTime)}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (!paint) {
            e.currentTarget.setPointerCapture(e.pointerId)
            seekAtClient(e.clientX, true)
            return
          }
          const b = beatOfClient(e.clientX)
          if (b == null) return
          const anchorBeat = Math.floor(b)
          const span = spanAt(anchorBeat)
          if (!span) return // chords live inside sections — nothing here
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag({ span, anchorBeat, curBeat: anchorBeat, moved: false })
        }}
        onPointerMove={(e) => {
          const b = beatOfClient(e.clientX)
          if (b == null) return
          if (drag) {
            const cur = clamp(Math.floor(b), drag.span.b0, drag.span.b1 - 1)
            if (cur !== drag.curBeat || !drag.moved)
              setDrag({
                ...drag,
                curBeat: cur,
                moved: drag.moved || cur !== drag.anchorBeat,
              })
            return
          }
          if (paint) {
            setHoverBeat(Math.floor(b))
            return
          }
          if (e.buttons & 1 && e.currentTarget.hasPointerCapture(e.pointerId))
            seekAtClient(e.clientX, false)
        }}
        onPointerUp={() => {
          if (!drag) return
          const stroke = strokeOf(
            drag.span,
            drag.anchorBeat,
            drag.curBeat,
            drag.moved,
          )
          if (stroke)
            onPaint(drag.span.id, stroke.s - drag.span.b0, stroke.e - stroke.s)
          setDrag(null)
        }}
        onPointerLeave={() => setHoverBeat(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && paint) {
            e.preventDefault()
            const b = Math.floor(beatAt(grid, currentTime))
            const span = spanAt(b)
            if (span)
              onPaint(
                span.id,
                b - span.b0,
                Math.max(1, Math.min(paint.dur, span.b1 - b)),
              )
            return
          }
          const B = grid.beatsPerBar
          const step =
            e.key === 'ArrowRight'
              ? 1
              : e.key === 'ArrowLeft'
                ? -1
                : e.key === 'ArrowUp'
                  ? -B
                  : e.key === 'ArrowDown'
                    ? B
                    : 0
          if (step === 0) return
          e.preventDefault()
          // Step from the player's authoritative time, not the display
          // clock — repeated presses must land deterministically even while
          // the smoothing is still catching up to the previous seek.
          const target = timeOfBeat(
            grid,
            Math.round(beatAt(grid, currentTime)) + step,
          )
          onSeek(clamp(target, 0, duration > 0 ? duration : target))
        }}
        className={`bevel-inset relative h-[54px] touch-none overflow-hidden rounded-sm border border-line bg-inset outline-none transition-colors focus-visible:border-accentink ${
          paint ? 'cursor-crosshair' : 'cursor-pointer'
        }`}
      >
        <div
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{ transform: `translate3d(${tx}px,0,0)` }}
        >
          {beats}
          {labels.map((e) => {
            const active = beatF >= e.startBeat && beatF < e.endBeat
            const past = e.endBeat <= beatF
            return (
              <span
                key={`${e.sectionId}:${e.startBeat}`}
                aria-hidden
                className={`absolute top-1/2 -translate-y-1/2 truncate font-mono text-[12px] leading-none ${
                  active
                    ? 'font-semibold text-fg'
                    : past
                      ? 'font-medium text-muted/70'
                      : 'font-medium text-muted'
                }`}
                style={{
                  left: e.startBeat * STRIDE + 6,
                  maxWidth: (e.endBeat - e.startBeat) * STRIDE - 10,
                }}
              >
                {e.name}
              </span>
            )
          })}
          {/* Paint ghost — the stroke that would land (hover preview) or is
              being dragged out; red dashes for the eraser. */}
          {ghost && paint && (
            <span
              aria-hidden
              className={`absolute inset-y-[5px] z-10 rounded-[5px] border border-dashed ${
                paint.name
                  ? 'border-accent bg-accent/10'
                  : 'border-danger bg-danger/10'
              } ${drag ? '' : 'opacity-70'}`}
              style={{
                left: ghost.s * STRIDE - 2,
                width: (ghost.e - ghost.s) * STRIDE - GAP + 4,
              }}
            >
              {paint.name && (
                <span className="absolute left-1.5 top-[3px] font-mono text-[10px] font-semibold leading-none text-accentink">
                  {paint.name}
                </span>
              )}
            </span>
          )}
        </div>
        {/* The fixed playhead — the lane's one signal-colored mark. */}
        {width > 0 && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-[2px] -translate-x-1/2 bg-accent"
            style={{ left: anchor }}
          >
            <span className="absolute -left-[4px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[rgb(var(--accent))]" />
          </div>
        )}
      </div>
    </div>
  )
}
