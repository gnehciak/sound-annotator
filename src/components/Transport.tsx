import { useEffect, useRef, useState } from 'react'
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronFirst,
  ChevronLast,
  ChevronDown,
  Check,
  SkipBack,
  SkipForward,
  Plus,
  X,
} from 'lucide-react'
import { formatTime, parseTime } from '../lib/format'

// Playback speeds, slow-first: slow a passage down to hear detail or speed it
// up to skim (pitch is preserved by the players). 1× is the default midpoint.
const RATES = [0.5, 0.75, 1, 1.5, 2] as const

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  pendingIn: number | null
  playbackRate: number
  hasNotes: boolean
  readOnly?: boolean
  onPlayPause: () => void
  onSeek: (t: number) => void
  onSetRate: (rate: number) => void
  onPrevNote: () => void
  onNextNote: () => void
  onMarkIn: () => void
  onMarkOut: () => void
  onCancelMark: () => void
  onAddNote: () => void
}

export default function Transport({
  isPlaying,
  currentTime,
  duration,
  pendingIn,
  playbackRate,
  hasNotes,
  readOnly = false,
  onPlayPause,
  onSeek,
  onSetRate,
  onPrevNote,
  onNextNote,
  onMarkIn,
  onMarkOut,
  onCancelMark,
  onAddNote,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // Playback-speed dropdown (open state + outside-click / Escape to close).
  const speedRef = useRef<HTMLDivElement>(null)
  const [speedOpen, setSpeedOpen] = useState(false)
  useEffect(() => {
    if (!speedOpen) return
    const onDown = (e: MouseEvent) => {
      if (!speedRef.current?.contains(e.target as Node)) setSpeedOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSpeedOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [speedOpen])

  const frac = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0

  // Quick-reference shortcut hints shown along the bottom of the transport.
  // Note actions (N / I·O) only apply when editing, so drop them in view-only.
  const hints: { keys: string[]; label: string }[] = [
    { keys: ['Space'], label: 'Play' },
    { keys: ['←', '→'], label: 'Seek' },
    ...(readOnly
      ? []
      : [
          { keys: ['N'], label: 'Note' },
          { keys: ['I', 'O'], label: 'Mark' },
        ]),
    { keys: ['?'], label: 'All' },
  ]

  const seekFromX = (clientX: number) => {
    const el = barRef.current
    if (!el || duration <= 0) return
    const rect = el.getBoundingClientRect()
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onSeek(f * duration)
  }

  const commitTime = () => {
    const parsed = parseTime(draft)
    if (parsed != null) onSeek(Math.max(0, parsed))
    setEditing(false)
  }

  return (
    <>
    <div className="space-y-2 rounded border border-line bg-panel p-2">
      {/* progress / seek bar, flanked by the (editable) current time and total */}
      <div className="flex items-center gap-2 px-0.5">
        <input
          value={editing ? draft : formatTime(currentTime)}
          onFocus={() => {
            setEditing(true)
            setDraft(formatTime(currentTime))
          }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitTime()
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              setEditing(false)
              e.currentTarget.blur()
            }
          }}
          onBlur={() => setEditing(false)}
          title="Type a time (m:ss or seconds) and press Enter to jump"
          aria-label="Current time — type to jump"
          className="led w-16 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-center text-sm leading-none outline-none focus:border-accent focus:bg-inset"
        />

        <div
          ref={barRef}
          onPointerDown={(e) => {
            draggingRef.current = true
            seekFromX(e.clientX)
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) seekFromX(e.clientX)
          }}
          onPointerUp={(e) => {
            draggingRef.current = false
            try {
              e.currentTarget.releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }}
          className="group relative flex-1 cursor-pointer touch-none py-2"
          title="Click or drag to jump"
        >
          <div className="h-1.5 w-full overflow-hidden rounded-full border border-line bg-inset">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${frac * 100}%` }}
            />
          </div>
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ink bg-accent opacity-80 transition-[opacity,transform] duration-100 ease-instr group-hover:scale-125 group-hover:opacity-100"
            style={{ left: `${frac * 100}%` }}
          />
        </div>

        <span className="shrink-0 font-mono text-xs text-muted">
          {formatTime(duration)}
        </span>

        {/* playback speed — a dropdown; a non-default rate flags amber on the trigger.
           `flex items-center` (not a bare block) so the inline-flex button isn't
           dropped onto the wrapper's text baseline — that left it sitting low
           relative to the bare time readouts. */}
        <div ref={speedRef} className="relative flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => setSpeedOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={speedOpen}
            aria-label={`Playback speed: ${playbackRate}×`}
            title="Playback speed"
            className={`press inline-flex items-center gap-0.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
              playbackRate !== 1
                ? 'border-accent/60 bg-accent/10 text-accent'
                : 'border-line bg-inset text-muted hover:text-fg'
            }`}
          >
            {playbackRate}×
            <ChevronDown
              size={11}
              className={`transition-transform duration-150 ${speedOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {speedOpen && (
            <div
              role="listbox"
              aria-label="Playback speed"
              className="absolute right-0 top-full z-30 mt-1 w-[4.25rem] animate-panel-in overflow-hidden rounded border border-line bg-panel shadow-lg shadow-black/40"
            >
              {RATES.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="option"
                  aria-selected={playbackRate === r}
                  onClick={() => {
                    onSetRate(r)
                    setSpeedOpen(false)
                  }}
                  className={`flex w-full items-center justify-between px-2 py-1 font-mono text-[11px] tabular-nums ${
                    playbackRate === r
                      ? 'bg-raised text-accent'
                      : 'text-muted hover:bg-raised/50 hover:text-fg'
                  }`}
                >
                  {r}×
                  {playbackRate === r && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* row 1: playback (flanked by prev/next-note jumps) */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <button
          onClick={onPrevNote}
          disabled={!hasNotes}
          aria-label="Previous note"
          title="Jump to the previous note (↑)"
          className="press inline-flex items-center border border-line px-2 py-1.5 text-muted hover:border-line-strong hover:text-fg disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
        >
          <SkipBack size={13} />
        </button>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 30))}
          aria-label="Back 30 seconds"
          title="Jump back 30 seconds (Shift ←)"
          className="press inline-flex items-center gap-1 border border-line px-2 py-1.5 font-mono text-xs text-muted hover:border-line-strong hover:text-fg"
        >
          <ChevronsLeft size={13} /> 30s
        </button>
        <button
          onClick={() => onSeek(Math.max(0, currentTime - 5))}
          aria-label="Back 5 seconds"
          title="Jump back 5 seconds (←)"
          className="press inline-flex items-center gap-1 border border-line px-2 py-1.5 font-mono text-xs text-muted hover:border-line-strong hover:text-fg"
        >
          <ChevronLeft size={13} /> 5s
        </button>
        <button
          onClick={onPlayPause}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          className="press bevel-raised inline-flex w-24 items-center justify-center gap-1.5 bg-accent py-1.5 text-sm font-bold text-ink hover:brightness-110"
        >
          {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => onSeek(currentTime + 5)}
          aria-label="Forward 5 seconds"
          title="Jump forward 5 seconds (→)"
          className="press inline-flex items-center gap-1 border border-line px-2 py-1.5 font-mono text-xs text-muted hover:border-line-strong hover:text-fg"
        >
          5s <ChevronRight size={13} />
        </button>
        <button
          onClick={() => onSeek(currentTime + 30)}
          aria-label="Forward 30 seconds"
          title="Jump forward 30 seconds (Shift →)"
          className="press inline-flex items-center gap-1 border border-line px-2 py-1.5 font-mono text-xs text-muted hover:border-line-strong hover:text-fg"
        >
          30s <ChevronsRight size={13} />
        </button>
        <button
          onClick={onNextNote}
          disabled={!hasNotes}
          aria-label="Next note"
          title="Jump to the next note (↓)"
          className="press inline-flex items-center border border-line px-2 py-1.5 text-muted hover:border-line-strong hover:text-fg disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
        >
          <SkipForward size={13} />
        </button>
      </div>
    </div>

    {/* Note actions get their own panel, set apart from the playback transport
       above so the primary "Add note" action reads as a distinct step. */}
    {!readOnly && (
    <div className="rounded border border-line bg-panel p-2">
      {/* Three equal columns (minmax(0,1fr)) so each action keeps the same
         width regardless of its contents. The Start cancel (X) lives inside
         column 1, so it never widens the row — it only eats into Start's own
         width, and Add note / Mark end never shift. */}
      <div className="grid grid-cols-3 items-stretch gap-1.5">
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={onMarkIn}
            title="Mark where a section starts (at the current time). Then mark the end to add a note covering that whole part. (I)"
            aria-label="Mark section start"
            className={`press inline-flex min-w-0 flex-1 items-center justify-center gap-1 border px-2 py-1.5 font-mono text-[11px] uppercase ${
              pendingIn != null
                ? 'border-accent/70 bg-accent/10 text-accent'
                : 'border-line text-muted hover:border-line-strong hover:text-fg'
            }`}
          >
            <ChevronFirst size={13} className="shrink-0" />
            <span className="truncate">
              {pendingIn != null ? `Start ${formatTime(pendingIn)}` : 'Mark start'}
            </span>
          </button>
          {pendingIn != null && (
            <button
              onClick={onCancelMark}
              aria-label="Cancel the marked start"
              title="Clear the pending start mark"
              className="press inline-flex shrink-0 items-center justify-center border border-l-0 border-accent/70 bg-accent/10 px-1.5 py-1.5 text-accent hover:bg-accent/20"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <button
          onClick={onAddNote}
          title="Add a note pinned to the current moment (N)"
          className="press inline-flex min-w-0 items-center justify-center gap-1.5 border border-accent/70 bg-accent/10 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-accent hover:bg-accent/20"
        >
          <Plus size={13} /> Add note
        </button>
        <button
          onClick={onMarkOut}
          disabled={pendingIn == null}
          title="Mark where the section ends, and add a note for that whole part (O)"
          aria-label="Mark section end and add the note"
          className="press inline-flex min-w-0 items-center justify-center gap-1 border border-line px-2 py-1.5 font-mono text-[11px] uppercase text-muted hover:border-line-strong hover:text-fg disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
        >
          Mark end <ChevronLast size={13} />
        </button>
      </div>
    </div>
    )}

    {/* keyboard shortcuts — beneath the panel, on the bare app background */}
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 opacity-60">
      {hints.map((h) => (
        <span key={h.label} className="flex items-center gap-1">
          <span className="flex items-center gap-0.5">
            {h.keys.map((k) => (
              <kbd key={k} className="kbd-cap">
                {k}
              </kbd>
            ))}
          </span>
          <span className="font-mono text-[10px] uppercase leading-none tracking-wider text-muted/70">
            {h.label}
          </span>
        </span>
      ))}
    </div>
    </>
  )
}
