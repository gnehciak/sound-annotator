import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  Check,
  Volume2,
  Volume1,
  VolumeX,
} from 'lucide-react'
import { formatTime, parseTime } from '../lib/format'

// Playback speeds, slow-first: slow a passage down to hear detail or speed it
// up to skim (pitch is preserved by the players). 1× is the default midpoint.
const RATES = [0.5, 0.75, 1, 1.5, 2] as const

interface Props {
  isPlaying: boolean
  currentTime: number
  duration: number
  playbackRate: number
  /** Current volume, 0–1. */
  volume: number
  muted: boolean
  readOnly?: boolean
  /**
   * Float the bar over the bottom edge of a video frame (rendered inside the
   * player's 16:9 box via PlayerPane's `overlay` slot) instead of docking it
   * as a well beneath the player. The keyboard hints are not rendered in
   * this mode — the host places {@link TransportHints} under the frame.
   */
  overlay?: boolean
  onPlayPause: () => void
  onSeek: (t: number) => void
  /** Relative ±seconds nudge (the 1s/5s buttons); accumulates across taps. */
  onStep: (delta: number) => void
  onSetRate: (rate: number) => void
  onSetVolume: (v: number) => void
  onToggleMute: () => void
}

export default function Transport({
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  volume,
  muted,
  readOnly = false,
  overlay = false,
  onPlayPause,
  onSeek,
  onStep,
  onSetRate,
  onSetVolume,
  onToggleMute,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // Set by Escape so the ensuing blur cancels instead of committing the draft.
  const skipCommitRef = useRef(false)

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

  // ---- Overlay mode: YouTube-style auto-hide + a compact row on narrow frames.
  // The bar shows on any pointer activity over the video frame (our parent)
  // and fades ~3s after the pointer goes idle while the tape rolls; it never
  // hides while paused, while the pointer is over the bar itself (aiming at
  // the seek bar must not make it vanish underfoot), while a control inside
  // it has focus, or while the speed menu is open. Leaving the frame hides
  // it at once.
  const rootRef = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(true)
  const [hoverBar, setHoverBar] = useState(false)
  const [focusWithin, setFocusWithin] = useState(false)
  const [compact, setCompact] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const armHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShown(false), 3000)
  }
  useEffect(() => {
    if (!overlay) return
    const frame = rootRef.current?.parentElement
    if (!frame) return
    const wake = () => {
      setShown(true)
      armHide()
    }
    const leave = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      setShown(false)
      setHoverBar(false)
    }
    frame.addEventListener('pointermove', wake)
    frame.addEventListener('pointerdown', wake)
    frame.addEventListener('pointerleave', leave)
    return () => {
      frame.removeEventListener('pointermove', wake)
      frame.removeEventListener('pointerdown', wake)
      frame.removeEventListener('pointerleave', leave)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [overlay])
  // Pressing play with the pointer at rest still lets the bar retire.
  useEffect(() => {
    if (!overlay || !isPlaying) return
    armHide()
  }, [overlay, isPlaying])
  // Narrow frames drop the ±5s steps so the row never wraps.
  useEffect(() => {
    if (!overlay) return
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setCompact(entry.contentRect.width < 460)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [overlay])
  const visible = !isPlaying || shown || hoverBar || focusWithin || speedOpen

  // Shared between the two layouts: the editable current-time field and the
  // seek bar's drag handling.
  const timeInputProps = {
    value: editing ? draft : formatTime(currentTime),
    onFocus: () => {
      setEditing(true)
      setDraft(formatTime(currentTime))
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
    onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.currentTarget.blur() // blur commits
      } else if (e.key === 'Escape') {
        e.preventDefault()
        skipCommitRef.current = true
        e.currentTarget.blur()
      }
    },
    onBlur: () => {
      // Defocusing confirms the typed time, same as Enter; Escape cancels.
      if (skipCommitRef.current) {
        skipCommitRef.current = false
        setEditing(false)
      } else {
        commitTime()
      }
    },
    title: 'Type a time (m:ss or seconds) and press Enter to jump',
    'aria-label': 'Current time — type to jump',
  }
  const barHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = true
      seekFromX(e.clientX)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (draggingRef.current) seekFromX(e.clientX)
    },
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
      draggingRef.current = false
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    },
  }

  if (overlay) {
    const iconBtn = 'btn-icon-lg on-video press'
    return (
      <div
        ref={rootRef}
        onPointerEnter={() => setHoverBar(true)}
        onPointerLeave={() => setHoverBar(false)}
        onFocus={() => setFocusWithin(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null))
            setFocusWithin(false)
        }}
        aria-hidden={!visible || undefined}
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pb-1.5 pt-12 transition-opacity duration-200 ease-instr ${
          visible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* seek bar — the full frame width; thin at rest, thicker under the pointer */}
        <div
          ref={barRef}
          {...barHandlers}
          className="group/bar relative cursor-pointer touch-none py-1.5"
          title="Click or drag to jump"
        >
          <div className="h-[3px] w-full overflow-hidden rounded-full bg-white/25 transition-[height] duration-100 group-hover/bar:h-[5px]">
            <div className="h-full bg-accent" style={{ width: `${frac * 100}%` }} />
          </div>
          <div
            className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity duration-100 group-hover/bar:opacity-100"
            style={{ left: `${frac * 100}%` }}
          />
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={onPlayPause}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className={iconBtn}
          >
            {isPlaying ? (
              <Pause size={17} className="fill-current" />
            ) : (
              <Play size={17} className="translate-x-px fill-current" />
            )}
          </button>
          {!compact && (
            <button
              onClick={() => onStep(-5)}
              aria-label="Back 5 seconds"
              title="Jump back 5 seconds (Shift ←)"
              className={iconBtn}
            >
              <ChevronsLeft size={15} />
            </button>
          )}
          <button
            onClick={() => onStep(-1)}
            aria-label="Back 1 second"
            title="Jump back 1 second (←)"
            className={iconBtn}
          >
            <ChevronLeft size={15} />
          </button>
          <button
            onClick={() => onStep(1)}
            aria-label="Forward 1 second"
            title="Jump forward 1 second (→)"
            className={iconBtn}
          >
            <ChevronRight size={15} />
          </button>
          {!compact && (
            <button
              onClick={() => onStep(5)}
              aria-label="Forward 5 seconds"
              title="Jump forward 5 seconds (Shift →)"
              className={iconBtn}
            >
              <ChevronsRight size={15} />
            </button>
          )}

          <span className="ml-1 flex min-w-0 items-center gap-1 font-mono text-[12px] tabular-nums text-white/90">
            <input
              {...timeInputProps}
              className="w-[50px] rounded bg-transparent px-1 py-0.5 text-center outline-none transition-colors hover:bg-white/10 focus:bg-white/15"
            />
            <span className="text-white/45">/</span>
            <span className="text-white/60">{formatTime(duration)}</span>
          </span>

          <div className="flex-1" />

          {/* playback speed — opens upward so the frame's overflow never clips it */}
          <div ref={speedRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setSpeedOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={speedOpen}
              aria-label={`Playback speed: ${playbackRate}×`}
              title="Playback speed"
              className={`press flex h-8 items-center rounded-full px-2.5 font-mono text-[11px] tabular-nums transition-colors hover:bg-white/10 ${
                playbackRate !== 1 ? 'text-accent' : 'text-white/85 hover:text-white'
              }`}
            >
              {playbackRate}×
            </button>
            {speedOpen && (
              <div
                role="listbox"
                aria-label="Playback speed"
                className="pop absolute bottom-full right-0 z-30 mb-1.5 w-[4.25rem] animate-panel-in py-1"
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
                        ? 'bg-raised text-accentink'
                        : 'text-muted hover:bg-fg/5 hover:text-fg'
                    }`}
                  >
                    {r}×
                    {playbackRate === r && <Check size={11} />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <VolumeControl
            tone="overlay"
            volume={volume}
            muted={muted}
            onSetVolume={onSetVolume}
            onToggleMute={onToggleMute}
          />
        </div>
      </div>
    )
  }

  return (
    <>
    <div className="well space-y-[11px] px-[13px] pb-[13px] pt-[11px]">
      {/* progress / seek bar, flanked by the (editable) current time and total */}
      <div className="flex items-center gap-2.5">
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
              e.currentTarget.blur() // blur commits
            } else if (e.key === 'Escape') {
              e.preventDefault()
              skipCommitRef.current = true
              e.currentTarget.blur()
            }
          }}
          onBlur={() => {
            // Defocusing confirms the typed time, same as Enter; Escape cancels.
            if (skipCommitRef.current) {
              skipCommitRef.current = false
              setEditing(false)
            } else {
              commitTime()
            }
          }}
          title="Type a time (m:ss or seconds) and press Enter to jump"
          aria-label="Current time — type to jump"
          className="led w-[72px] shrink-0 rounded border border-transparent bg-transparent px-2 py-1 text-center text-[14px] font-medium leading-none outline-none transition-colors hover:border-line hover:bg-inset focus:border-accent focus:bg-inset"
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
            className="absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-accent opacity-80 transition-[opacity,transform] duration-100 ease-instr group-hover:scale-125 group-hover:opacity-100"
            style={{ left: `${frac * 100}%` }}
          />
        </div>

        <span className="shrink-0 font-mono text-xs text-muted">
          {formatTime(duration)}
        </span>
      </div>

      {/* row 1: playback — speed in the left corner, volume in the right,
         icon-only ±1s/±5s nudges around play in the center */}
      <div className="flex items-center gap-1.5">
        {/* playback speed — a dropdown; a non-default rate flags amber on the trigger */}
        <div ref={speedRef} className="relative flex flex-1 items-center justify-start">
          <button
            type="button"
            onClick={() => setSpeedOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={speedOpen}
            aria-label={`Playback speed: ${playbackRate}×`}
            title="Playback speed"
            className="chip chip-outline press text-[11px] normal-case tracking-normal tabular-nums"
            style={{
              ['--hue' as string]:
                playbackRate !== 1 ? 'rgb(var(--accent-ink))' : 'rgb(var(--text-muted))',
            }}
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
              className="pop absolute left-0 top-full z-30 mt-1 w-[4.25rem] animate-panel-in py-1"
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
                      ? 'bg-raised text-accentink'
                      : 'text-muted hover:bg-fg/5 hover:text-fg'
                  }`}
                >
                  {r}×
                  {playbackRate === r && <Check size={11} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-[7px]">
          <button
            onClick={() => onStep(-5)}
            aria-label="Back 5 seconds"
            title="Jump back 5 seconds (Shift ←)"
            className="btn-ghost press rounded-full px-3"
          >
            <ChevronsLeft size={13} />
          </button>
          <button
            onClick={() => onStep(-1)}
            aria-label="Back 1 second"
            title="Jump back 1 second (←)"
            className="btn-ghost press rounded-full px-3"
          >
            <ChevronLeft size={13} />
          </button>
          <button
            onClick={onPlayPause}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className="btn-primary press w-[104px] gap-[7px] text-[13.5px]"
          >
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button
            onClick={() => onStep(1)}
            aria-label="Forward 1 second"
            title="Jump forward 1 second (→)"
            className="btn-ghost press rounded-full px-3"
          >
            <ChevronRight size={13} />
          </button>
          <button
            onClick={() => onStep(5)}
            aria-label="Forward 5 seconds"
            title="Jump forward 5 seconds (Shift →)"
            className="btn-ghost press rounded-full px-3"
          >
            <ChevronsRight size={13} />
          </button>
        </div>

        <div className="flex flex-1 items-center justify-end">
          <VolumeControl
            volume={volume}
            muted={muted}
            onSetVolume={onSetVolume}
            onToggleMute={onToggleMute}
          />
        </div>
      </div>
    </div>

    <TransportHints readOnly={readOnly} />
    </>
  )
}

/**
 * Quick-reference shortcut hints — the row beneath the transport (or, in
 * overlay mode, beneath the video frame). Note actions (N / I·O) only apply
 * when editing, so they're dropped in view-only.
 */
export function TransportHints({ readOnly = false }: { readOnly?: boolean }) {
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
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3.5 gap-y-1.5 opacity-70">
      {hints.map((h) => (
        <span key={h.label} className="flex items-center gap-[5px]">
          <span className="flex items-center gap-0.5">
            {h.keys.map((k) => (
              <kbd key={k} className="kbd-cap">
                {k}
              </kbd>
            ))}
          </span>
          <span className="font-mono text-[9.5px] uppercase leading-none tracking-[0.14em] text-muted">
            {h.label}
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * Collapsed-by-default volume: just the speaker icon; a click opens a small
 * popover holding a vertical drag/click slider (volume rises upward). While
 * open, the icon doubles as the mute toggle; outside click or Escape
 * dismisses it. Drives the loaded player's volume (YouTube via the
 * IFrame API, audio via wavesurfer). The slider also takes arrow keys when
 * focused — stopPropagation keeps those off the global ←/→ seek shortcuts.
 * Exported for the structure board's folded transport (MiniTransport).
 */
export function VolumeControl({
  volume,
  muted,
  onSetVolume,
  onToggleMute,
  tone = 'panel',
}: {
  volume: number
  muted: boolean
  onSetVolume: (v: number) => void
  onToggleMute: () => void
  /** 'overlay': white glyph for the floating video bar (see Transport). */
  tone?: 'panel' | 'overlay'
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const level = muted ? 0 : volume
  const pct = Math.round(level * 100)
  const Icon = level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2

  // Collapse the revealed slider on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Vertical track: volume rises toward the top, so invert against rect.bottom.
  const setFromY = (clientY: number) => {
    const el = trackRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    onSetVolume(Math.min(1, Math.max(0, (rect.bottom - clientY) / rect.height)))
  }

  return (
    <div ref={wrapRef} className="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => (open ? onToggleMute() : setOpen(true))}
        aria-label={open ? (muted ? 'Unmute' : 'Mute') : 'Volume'}
        aria-expanded={open}
        title={open ? (muted ? 'Unmute' : 'Mute') : `Volume ${pct}%`}
        className={
          tone === 'overlay'
            ? `btn-icon-lg on-video press ${muted ? 'text-accent' : ''}`
            : `btn-icon press ${muted ? 'text-accentink' : ''}`
        }
      >
        <Icon size={15} />
      </button>
      {open && (
      // Static -translate-x-1/2 centering lives on this outer wrapper because
      // panel-in fills `transform: none` and would clobber it on the same node.
      <div className="absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2">
      <div className="pop animate-panel-in px-[7px] py-2.5">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        title={`Volume ${pct}%`}
        onPointerDown={(e) => {
          draggingRef.current = true
          setFromY(e.clientY)
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) setFromY(e.clientY)
        }}
        onPointerUp={(e) => {
          draggingRef.current = false
          try {
            e.currentTarget.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            e.stopPropagation()
            onSetVolume(Math.min(1, level + 0.05))
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            e.stopPropagation()
            onSetVolume(Math.max(0, level - 0.05))
          }
        }}
        className="group relative h-[84px] cursor-pointer touch-none px-1.5 outline-none"
      >
        <div className="relative h-full w-1.5 overflow-hidden rounded-full border border-line bg-inset group-focus-visible:border-accent">
          <div
            className="absolute bottom-0 w-full rounded-full bg-accent"
            style={{ height: `${pct}%` }}
          />
        </div>
        <div
          className="absolute left-1/2 h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-ink bg-accent opacity-80 transition-[opacity,transform] duration-100 ease-instr group-hover:scale-125 group-hover:opacity-100"
          style={{ bottom: `${pct}%` }}
        />
      </div>
      </div>
      </div>
      )}
    </div>
  )
}
