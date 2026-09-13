import { useRef, useState } from 'react'
import { Crosshair, Minus, Music2, Plus, Trash2 } from 'lucide-react'
import type { Chord, ChordMode, ProjectChords } from '../../types'
import {
  BEATS_PER_BAR_OPTIONS,
  CHORD_MODES,
  KEY_NAMES,
  MAX_BPM,
  MIN_BPM,
  MIN_CHORD_BEATS,
  chordAt,
  chordGap,
  degreeColor,
  describeLength,
  spellChord,
  tapTempo,
  timeBeat,
} from '../../lib/chords'
import { formatTime, parseTime } from '../../lib/format'
import { hueText } from '../../lib/noteColors'
import { useResolvedTheme } from '../../lib/theme'
import { clamp } from './drag'

/**
 * The chord track's controls, in two pieces the board places separately.
 *
 * `ChordSetupRow` is the grid: key and mode, tempo (typed or tapped), metre,
 * and where the first downbeat falls — plus the chord sounding *now*, in the
 * LED voice the transport clock uses, because when the tempo is right the
 * readout changes exactly on the bar line and when it is wrong you can see
 * it drift. Retuning any of these moves every chord together, which is the
 * point of writing chords in beats and degrees rather than seconds and names.
 *
 * `ChordFooter` edits the selected chord: its degree, whether it carries a
 * seventh, its inversion, and its length — the same verbs the digit keys
 * and the drag handles offer, for anyone without a keyboard in hand.
 */

const round1 = (x: number) => Math.round(x * 10) / 10

/** The downbeat as m:ss.cc — hundredths, since a downbeat is a sub-second
 *  thing — with a sign, since a pickup can put bar 1 before the clip starts. */
function formatOffset(seconds: number): string {
  const abs = Math.abs(seconds)
  const whole = Math.floor(abs)
  const cents = Math.round((abs - whole) * 100)
  return `${seconds < 0 ? '-' : ''}${formatTime(whole)}.${String(cents).padStart(2, '0')}`
}

/** m:ss.cc, m:ss or plain seconds, optionally negative. */
function parseOffset(input: string): number | null {
  const s = input.trim()
  const neg = s.startsWith('-')
  const v = parseTime(neg ? s.slice(1) : s)
  return v == null ? null : neg ? -v : v
}

type Change = (next: ProjectChords, opts?: { coalesceKey?: string }) => void

export function ChordSetupRow({
  chords,
  currentTime,
  readOnly,
  onChange,
  onRemove,
}: {
  chords: ProjectChords
  currentTime: number
  readOnly: boolean
  onChange: Change
  onRemove: () => void
}) {
  const theme = useResolvedTheme()
  const tapsRef = useRef<number[]>([])
  const [bpmDraft, setBpmDraft] = useState<string | null>(null)
  const [offsetDraft, setOffsetDraft] = useState<string | null>(null)

  const now = chordAt(chords.chords, timeBeat(chords, currentTime))
  const spelled = now ? spellChord(now, chords.key, chords.mode) : null
  const nowColor = now ? degreeColor(now.degree) : null

  const commitBpm = () => {
    if (bpmDraft == null) return
    const v = Number(bpmDraft)
    if (Number.isFinite(v) && v > 0)
      onChange({ ...chords, bpm: round1(clamp(v, MIN_BPM, MAX_BPM)) })
    setBpmDraft(null)
  }
  const commitOffset = () => {
    if (offsetDraft == null) return
    const v = parseOffset(offsetDraft)
    if (v != null) onChange({ ...chords, offset: Math.round(v * 100) / 100 })
    setOffsetDraft(null)
  }

  const onTap = () => {
    const { taps, bpm } = tapTempo(tapsRef.current, performance.now())
    tapsRef.current = taps
    if (bpm != null)
      onChange(
        { ...chords, bpm: clamp(bpm, MIN_BPM, MAX_BPM) },
        { coalesceKey: 'chord-tap' },
      )
  }

  const selectClass =
    'field w-auto cursor-pointer appearance-none px-2 py-[3px] font-mono text-[11px] uppercase tracking-[0.06em]'
  const labelClass =
    'font-mono text-[9px] uppercase tracking-[0.16em] text-muted'

  return (
    <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/70 px-3.5 py-1">
      {/* Now — the sounding chord, the clock's own voice. */}
      <div
        className="flex w-[104px] shrink-0 items-baseline gap-1.5"
        aria-live="polite"
        title="The chord sounding now"
      >
        <Music2 size={12} className="shrink-0 self-center text-muted" aria-hidden />
        {spelled ? (
          <>
            <span
              className="text-[18px] font-bold leading-none"
              style={{ color: nowColor ? hueText(nowColor, theme) : undefined }}
            >
              {spelled.roman}
              {spelled.figure && (
                <sup className="ml-[1px] align-[0.55em] text-[9px]">{spelled.figure}</sup>
              )}
            </span>
            <span className="led truncate text-[11px]">{spelled.name}</span>
          </>
        ) : (
          <span className="led text-[11px] opacity-50">—</span>
        )}
      </div>

      <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

      {/* Key. */}
      <label className="flex shrink-0 items-center gap-1.5">
        <span className={labelClass}>Key</span>
        <select
          value={chords.key}
          disabled={readOnly}
          onChange={(e) => onChange({ ...chords, key: e.target.value })}
          aria-label="Key"
          className={selectClass}
        >
          {KEY_NAMES.map((k) => (
            <option key={k} value={k}>
              {k.replace('#', '♯').replace('b', '♭')}
            </option>
          ))}
        </select>
        <select
          value={chords.mode}
          disabled={readOnly}
          onChange={(e) => onChange({ ...chords, mode: e.target.value as ChordMode })}
          aria-label="Mode"
          className={selectClass}
        >
          {CHORD_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

      {/* Tempo — typed, or tapped along with the music. */}
      <label className="flex shrink-0 items-center gap-1.5">
        <span className={labelClass}>Tempo</span>
        <input
          value={bpmDraft ?? String(chords.bpm)}
          disabled={readOnly}
          inputMode="decimal"
          onFocus={() => setBpmDraft(String(chords.bpm))}
          onChange={(e) => setBpmDraft(e.target.value)}
          onBlur={commitBpm}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setBpmDraft(null)
              e.currentTarget.blur()
            }
          }}
          aria-label="Tempo in beats per minute"
          title={`Tempo, ${MIN_BPM}–${MAX_BPM} bpm`}
          className="field w-[58px] px-2 py-[3px] text-center font-mono text-[11px] tabular-nums"
        />
        <span className={labelClass}>bpm</span>
      </label>
      {!readOnly && (
        <button
          type="button"
          onClick={onTap}
          title="Tap along with the beat to set the tempo"
          className="btn-ghost btn-sm press shrink-0"
        >
          Tap
        </button>
      )}

      <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

      {/* Metre. */}
      <label className="flex shrink-0 items-center gap-1.5">
        <select
          value={chords.beatsPerBar}
          disabled={readOnly}
          onChange={(e) => onChange({ ...chords, beatsPerBar: Number(e.target.value) })}
          aria-label="Beats per bar"
          className={selectClass}
        >
          {BEATS_PER_BAR_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}/4
            </option>
          ))}
        </select>
      </label>

      <span aria-hidden className="h-4 w-px shrink-0 bg-line" />

      {/* The first downbeat: typed, or taken from the playhead. */}
      <label className="flex shrink-0 items-center gap-1.5">
        <span className={labelClass}>Bar 1</span>
        <input
          value={offsetDraft ?? formatOffset(chords.offset)}
          disabled={readOnly}
          onFocus={() => setOffsetDraft(formatOffset(chords.offset))}
          onChange={(e) => setOffsetDraft(e.target.value)}
          onBlur={commitOffset}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') {
              setOffsetDraft(null)
              e.currentTarget.blur()
            }
          }}
          aria-label="Time of the first downbeat, in seconds"
          title="Where bar 1 begins (m:ss.cc, or seconds)"
          className="field w-[64px] px-2 py-[3px] text-center font-mono text-[11px] tabular-nums"
        />
        {!readOnly && (
          <button
            type="button"
            onClick={() =>
              onChange({ ...chords, offset: Math.round(currentTime * 100) / 100 })
            }
            title="Put bar 1 at the playhead"
            aria-label="Put bar 1 at the playhead"
            className="btn-icon press"
          >
            <Crosshair size={12} />
          </button>
        )}
      </label>

      <div className="flex-1" />

      {!readOnly && (
        <button
          type="button"
          onClick={onRemove}
          title="Remove the chord track"
          aria-label="Remove the chord track"
          className="btn-icon press shrink-0 hover:text-danger"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  )
}

/** The selected chord's controls, in the board's fixed footer slot. */
export function ChordFooter({
  chords,
  chord,
  onChange,
  onDelete,
}: {
  chords: ProjectChords
  chord: Chord
  onChange: Change
  onDelete: () => void
}) {
  const theme = useResolvedTheme()
  const color = degreeColor(chord.degree)
  const spelled = spellChord(chord, chords.key, chords.mode)
  const patch = (p: Partial<Chord>) =>
    onChange({
      ...chords,
      chords: chords.chords.map((c) => (c.id === chord.id ? { ...c, ...p } : c)),
    })
  const maxInv = chord.seventh ? 3 : 2
  const { hi } = chordGap(chords.chords, chord.beat + chord.len / 2, chord.id)
  const step = (by: number) => {
    const len = clamp(chord.len + by, MIN_CHORD_BEATS, hi - chord.beat)
    if (len !== chord.len) patch({ len })
  }

  return (
    <>
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 rounded-sm"
        style={{ background: color }}
      />
      <span
        className="w-[96px] shrink-0 truncate text-[17px] font-bold leading-none"
        style={{ color: hueText(color, theme) }}
        title={`${spelled.roman}${spelled.figure} — ${spelled.name}`}
      >
        {spelled.roman}
        {spelled.figure && <sup className="ml-[1px] text-[8px]">{spelled.figure}</sup>}
        <span className="ml-1.5 font-mono text-[10px] font-normal text-muted">
          {spelled.name}
        </span>
      </span>

      <div role="group" aria-label="Scale degree" className="seg">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const s = spellChord({ degree: d }, chords.key, chords.mode)
          return (
            <button
              key={d}
              type="button"
              onClick={() => patch({ degree: d, inversion: undefined })}
              aria-pressed={chord.degree === d}
              title={`${s.roman} — ${s.name} (${d})`}
              className="seg-item press h-[22px] min-w-[26px] px-1 text-[10.5px] normal-case tracking-normal"
              style={
                chord.degree === d
                  ? { color: hueText(degreeColor(d), theme) }
                  : undefined
              }
            >
              {s.roman}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={() =>
          patch({
            seventh: chord.seventh ? undefined : true,
            inversion:
              chord.seventh && (chord.inversion ?? 0) > 2 ? undefined : chord.inversion,
          })
        }
        aria-pressed={!!chord.seventh}
        title="Add the seventh (⇧ + digit)"
        className="chip chip-outline press text-[10px] font-semibold"
        style={{ ['--hue' as string]: color }}
      >
        7th
      </button>

      <div role="group" aria-label="Inversion" className="seg">
        {['Root', '1st', '2nd', '3rd'].slice(0, maxInv + 1).map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => patch({ inversion: i === 0 ? undefined : i })}
            aria-pressed={(chord.inversion ?? 0) === i}
            aria-label={i === 0 ? 'Root position' : `${label} inversion`}
            title={i === 0 ? 'Root position' : `${label} inversion`}
            className="seg-item press h-[22px] min-w-[24px] px-1"
          >
            {i === 0 ? 'R' : String(i)}
          </button>
        ))}
      </div>

      <div
        className="flex items-center gap-1 font-mono text-[10.5px] tabular-nums text-muted"
        title="Length — drag the chord's edge, or step it here"
      >
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={chord.len <= MIN_CHORD_BEATS}
          aria-label="One beat shorter"
          className="btn-icon press disabled:pointer-events-none disabled:opacity-35"
        >
          <Minus size={11} />
        </button>
        <span className="min-w-[44px] whitespace-nowrap text-center">
          {describeLength(chord.len, chords.beatsPerBar)}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={chord.beat + chord.len + 1 > hi}
          aria-label="One beat longer"
          className="btn-icon press disabled:pointer-events-none disabled:opacity-35"
        >
          <Plus size={11} />
        </button>
      </div>

      <div className="flex-1" />
      <button
        type="button"
        onClick={onDelete}
        title="Delete chord (⌫)"
        aria-label="Delete chord"
        className="btn-icon press hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </>
  )
}
