import { useEffect, useMemo, useRef } from 'react'
import type { Chord, ProjectChords } from '../../types'
import {
  MIN_CHORD_BEATS,
  beatQuantum,
  beatTime,
  chordGap,
  degreeColor,
  snapBeat,
  sortedChords,
  spellChord,
  timeBeat,
} from '../../lib/chords'
import { hueText } from '../../lib/noteColors'
import { useResolvedTheme } from '../../lib/theme'
import { type BeginDrag, clamp, hexA } from './drag'

/**
 * The chord lane under the section lane of the structure board: the beat
 * grid (bars strong, beats faint) and the chords written on it, coloured by
 * degree. It shares the board's zoom window and pixel scale, so a chord sits
 * under the section it belongs to and the playhead runs through both.
 *
 * Gestures: a press on empty grid places the *cursor* — where the next digit
 * writes — and seeks the player there, so the two never disagree; dragging
 * scrubs. A press on a chord selects it; a drag moves it inside the room its
 * neighbours leave, and its edges resize it, both snapped to the grid the
 * current zoom can show. Owns no state: the cursor and the selection live in
 * the board, because the digit keys that use them are the board's.
 */

export const CHORD_LANE_H = 50

interface Props {
  chords: ProjectChords
  vs: number
  ve: number
  pps: number
  xOf: (t: number) => number
  tOfClient: (clientX: number) => number
  beginDrag: BeginDrag
  currentTime: number
  isPlaying: boolean
  readOnly: boolean
  selectedId: string | null
  /** The insertion point, in beats — null means "the playhead". */
  cursor: number | null
  onSelect: (id: string | null) => void
  onCursor: (beat: number) => void
  onSeek: (t: number) => void
  onChange: (next: ProjectChords, opts?: { coalesceKey?: string }) => void
}

export default function ChordLane({
  chords,
  vs,
  ve,
  pps,
  xOf,
  tOfClient,
  beginDrag,
  currentTime,
  isPlaying,
  readOnly,
  selectedId,
  cursor,
  onSelect,
  onCursor,
  onSeek,
  onChange,
}: Props) {
  const theme = useResolvedTheme()
  const ordered = useMemo(() => sortedChords(chords.chords), [chords.chords])
  const ppb = (pps * 60) / chords.bpm
  const quantum = beatQuantum(ppb, chords.beatsPerBar)

  const liveRef = useRef({ chords, ordered, quantum })
  useEffect(() => {
    liveRef.current = { chords, ordered, quantum }
  })

  const beatOfClient = (clientX: number) =>
    timeBeat(liveRef.current.chords, tOfClient(clientX))

  // ---- the grid ------------------------------------------------------------
  const grid = useMemo(() => {
    const bars: { x: number; n: number }[] = []
    const beats: number[] = []
    if (pps <= 0 || ve <= vs) return { bars, beats }
    const { beatsPerBar } = chords
    const b0 = Math.ceil(timeBeat(chords, vs))
    const b1 = Math.floor(timeBeat(chords, ve))
    // Too many beats to draw is too many to read: thin to bars, then to
    // every few bars, before the lines become a grey wash.
    const barStep =
      ppb * beatsPerBar >= 24 ? 1 : ppb * beatsPerBar >= 6 ? 4 : 16
    for (let b = b0; b <= b1; b++) {
      const x = xOf(beatTime(chords, b))
      const bar = Math.floor(b / beatsPerBar)
      if (b % beatsPerBar === 0) {
        if (bar % barStep === 0) bars.push({ x, n: bar + 1 })
      } else if (ppb >= 7) beats.push(x)
    }
    return { bars, beats }
  }, [chords, vs, ve, pps, ppb, xOf])

  const nowBeat = timeBeat(chords, currentTime)

  // ---- gestures ------------------------------------------------------------

  function onLaneDown(e: React.PointerEvent) {
    if (e.button !== 0 || e.shiftKey) return // shift bubbles to the board's pan
    e.stopPropagation()
    const place = (clientX: number) => {
      const b = snapBeat(beatOfClient(clientX), liveRef.current.quantum)
      onCursor(b)
      onSeek(Math.max(0, beatTime(liveRef.current.chords, b)))
    }
    onSelect(null)
    place(e.clientX)
    beginDrag((ev) => place(ev.clientX))
  }

  const onChordDown = (chord: Chord) => (e: React.PointerEvent) => {
    if (e.button !== 0 || e.shiftKey) return
    e.stopPropagation()
    if (readOnly) {
      onSeek(Math.max(0, beatTime(chords, chord.beat)))
      return
    }
    onSelect(chord.id)
    const grab = beatOfClient(e.clientX) - chord.beat
    const x0 = e.clientX
    let moved = false
    beginDrag(
      (ev) => {
        if (!moved && Math.abs(ev.clientX - x0) < 3) return
        moved = true
        const { chords: live, ordered, quantum } = liveRef.current
        const cur = live.chords.find((c) => c.id === chord.id)
        if (!cur) return
        const { lo, hi } = chordGap(ordered, cur.beat + cur.len / 2, chord.id)
        const raw = snapBeat(beatOfClient(ev.clientX) - grab, quantum)
        const beat = clamp(raw, lo, hi - cur.len)
        if (beat === cur.beat) return
        onChange(
          {
            ...live,
            chords: live.chords.map((c) => (c.id === chord.id ? { ...c, beat } : c)),
          },
          { coalesceKey: `chord-move:${chord.id}` },
        )
      },
      undefined,
      'grabbing',
    )
  }

  const onHandleDown =
    (chord: Chord, edge: 'start' | 'end') => (e: React.PointerEvent) => {
      if (e.button !== 0 || e.shiftKey || readOnly) return
      e.stopPropagation()
      onSelect(chord.id)
      beginDrag(
        (ev) => {
          const { chords: live, ordered, quantum } = liveRef.current
          const cur = live.chords.find((c) => c.id === chord.id)
          if (!cur) return
          const { lo, hi } = chordGap(ordered, cur.beat + cur.len / 2, chord.id)
          const raw = snapBeat(beatOfClient(ev.clientX), quantum)
          const end = cur.beat + cur.len
          const next =
            edge === 'start'
              ? (() => {
                  const beat = clamp(raw, lo, end - MIN_CHORD_BEATS)
                  return { beat, len: end - beat }
                })()
              : { beat: cur.beat, len: clamp(raw, cur.beat + MIN_CHORD_BEATS, hi) - cur.beat }
          if (next.beat === cur.beat && next.len === cur.len) return
          onChange(
            {
              ...live,
              chords: live.chords.map((c) =>
                c.id === chord.id ? { ...c, ...next } : c,
              ),
            },
            { coalesceKey: `chord-resize:${chord.id}` },
          )
        },
        undefined,
        'ew-resize',
      )
    }

  const cursorX =
    cursor != null && !isPlaying ? xOf(beatTime(chords, cursor)) : null

  return (
    <div
      onPointerDown={onLaneDown}
      aria-label="Chord track"
      title={
        readOnly
          ? 'The chord progression — click a chord to play from it'
          : 'Click to place the cursor · press 1–7 to write a chord there'
      }
      className="bevel-inset relative touch-none overflow-hidden rounded-b-sm border border-t-0 border-line bg-inset"
      style={{ height: CHORD_LANE_H, cursor: readOnly ? 'pointer' : 'text' }}
    >
      {/* Beat grid: bars strong and numbered, beats a faint hairline. */}
      {grid.beats.map((x) => (
        <span
          key={`b${x}`}
          aria-hidden
          className="absolute inset-y-0 w-px bg-line/35"
          style={{ left: x }}
        />
      ))}
      {grid.bars.map((bar) => (
        <span key={`bar${bar.n}`} aria-hidden>
          <span
            className="absolute inset-y-0 w-px bg-line-strong/70"
            style={{ left: bar.x }}
          />
          {ppb * chords.beatsPerBar >= 30 && (
            <span
              className="absolute bottom-[2px] font-mono text-[8px] tabular-nums leading-none text-muted/80"
              style={{ left: bar.x + 3 }}
            >
              {bar.n}
            </span>
          )}
        </span>
      ))}

      {ordered.length === 0 && (
        <p className="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          {readOnly
            ? 'No chords yet'
            : 'Press 1–7 to write a chord at the playhead'}
        </p>
      )}

      {ordered.map((chord) => {
        const t0 = beatTime(chords, chord.beat)
        const t1 = beatTime(chords, chord.beat + chord.len)
        if (t1 < vs || t0 > ve) return null
        const left = xOf(t0)
        const w = Math.max(xOf(t1) - left, 2)
        const color = degreeColor(chord.degree)
        const isSel = chord.id === selectedId
        const sounding = chord.beat <= nowBeat && nowBeat < chord.beat + chord.len
        const spelled = spellChord(chord, chords.key, chords.mode)
        const label = `${spelled.roman}${spelled.figure} · ${spelled.name}`
        return (
          <div
            key={chord.id}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={isSel || undefined}
            onPointerDown={onChordDown(chord)}
            onDoubleClick={() => onSeek(Math.max(0, t0))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                if (readOnly) onSeek(Math.max(0, t0))
                else onSelect(chord.id)
              }
            }}
            title={label}
            className={`group absolute inset-y-[3px] touch-none overflow-hidden rounded-[3px] border outline-none transition-[filter] ${
              isSel ? 'z-10 shadow-[inset_0_0_0_1.5px_rgb(var(--text)/0.6)]' : ''
            }`}
            style={{
              left,
              width: w,
              background: hexA(color, isSel ? 0.55 : sounding ? 0.5 : 0.3),
              borderColor: hexA(color, sounding ? 1 : 0.8),
              cursor: readOnly ? 'pointer' : 'grab',
              filter: sounding ? 'brightness(1.12)' : undefined,
            }}
          >
            {/* The numeral is the mark — big enough to read across the
                room; the letter name rides small beside it when there is
                room, since the numeral is what the lesson is about. */}
            {w > 20 && (
              <span className="pointer-events-none absolute inset-y-0 left-[7px] flex items-center gap-1.5 whitespace-nowrap">
                <span
                  className="text-[22px] font-bold leading-none tracking-[-0.01em]"
                  style={{ color: hueText(color, theme) }}
                >
                  {spelled.roman}
                  {spelled.figure && (
                    <sup className="ml-[1px] align-[0.55em] text-[10px] font-semibold">
                      {spelled.figure}
                    </sup>
                  )}
                </span>
                {w > 76 && (
                  <span className="mt-[5px] font-mono text-[10px] leading-none text-fg/70">
                    {spelled.name}
                  </span>
                )}
              </span>
            )}
            {!readOnly && (
              <>
                <div
                  aria-hidden
                  onPointerDown={onHandleDown(chord, 'start')}
                  className="absolute inset-y-0 left-0 w-[6px] cursor-ew-resize"
                >
                  <span
                    className="absolute inset-y-0 left-0 w-[3px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ background: color }}
                  />
                </div>
                <div
                  aria-hidden
                  onPointerDown={onHandleDown(chord, 'end')}
                  className="absolute inset-y-0 right-0 w-[6px] cursor-ew-resize"
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

      {/* The cursor: where the next digit writes. Hidden while playing, when
          the playhead is the insertion point instead. */}
      {!readOnly && cursorX != null && cursorX >= 0 && cursorX <= xOf(ve) && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 z-20 w-[2px] -translate-x-1/2 bg-fg/80"
          style={{ left: cursorX }}
        >
          <span className="absolute -left-[3px] bottom-0 h-[2px] w-[8px] bg-fg/80" />
          <span className="absolute -left-[3px] top-0 h-[2px] w-[8px] bg-fg/80" />
        </div>
      )}
    </div>
  )
}
