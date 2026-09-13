import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Pause, Pencil, Play, Trash2, X } from 'lucide-react'
import type { LyricLine } from '../../types'
import { formatTenths } from '../../lib/format'
import {
  clearAllTimes,
  DEFAULT_LYRIC_LEAD,
  firstUntimed,
  lyricsText,
  retextLyrics,
  stampLine,
} from '../../lib/lyrics'
import { isTypingTarget } from '../../lib/useHotkeys'

/**
 * The timing workspace: paste the whole lyric, play the song, and press → as
 * each line begins. That one press is the whole tool — it stamps the line
 * under the cursor with the playhead (lead taken off) and moves the cursor to
 * the next — so a live pass is one press per line, and a wrong line is fixed
 * by clicking it, scrubbing to its moment and pressing again. ← steps the
 * cursor back a line without stamping, for a press that came a line early.
 *
 * It takes the arrow keys off the transport while it is open (capture-phase,
 * so the app's global hotkeys never see them), which is deliberate: during a
 * pass, "next line" is the only thing → can honestly mean. Both keys stand
 * down inside the text box and the lead field, like every other shortcut.
 *
 * Two stages in one panel. The **text** stage is a box for the paste, one
 * line per lyric line; it opens first when the track has no lyrics, and
 * again from *Edit text* — re-running the paste keeps the stamps of every
 * line whose words survived (`retextLyrics`), so a typo fixed on line 12 is
 * not eleven presses. The **stamping** stage is the list with the cursor on
 * the next line to time, each stamped line showing where it landed.
 *
 * The lead offset is the same idea as the score's page turns: the press lands
 * after the moment it marks, by roughly a constant, so the stamp goes in
 * that much earlier. Session state, like which pen is in your hand.
 */
export default function LyricTimer({
  lines,
  currentTime,
  isPlaying,
  onPlayPause,
  onSeek,
  onChange,
  onClose,
}: {
  lines: LyricLine[]
  /** Clip time, the clock every stamp is written in. */
  currentTime: number
  isPlaying: boolean
  onPlayPause: () => void
  onSeek: (t: number) => void
  onChange: (lines: LyricLine[]) => void
  onClose: () => void
}) {
  const [editingText, setEditingText] = useState(lines.length === 0)
  const [draft, setDraft] = useState(() => lyricsText(lines))
  const [cursor, setCursor] = useState(() => firstUntimed(lines))
  const [lead, setLead] = useState(DEFAULT_LYRIC_LEAD)
  const cursorRef = useRef<HTMLLIElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  const done = cursor >= lines.length
  const at = Math.max(0, currentTime - lead)

  const stamp = useCallback(() => {
    if (done) return
    onChange(stampLine(lines, cursor, at))
    setCursor(cursor + 1)
  }, [done, onChange, lines, cursor, at])

  const back = useCallback(() => {
    setCursor((c) => Math.max(0, c - 1))
  }, [])

  // Read through refs so the listener subscribes once: `stamp` closes over
  // the playhead and is therefore a new function on every tick of the clock.
  const stampRef = useRef(stamp)
  const backRef = useRef(back)
  useLayoutEffect(() => {
    stampRef.current = stamp
    backRef.current = back
  })
  useEffect(() => {
    if (editingText) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'ArrowRight') stampRef.current()
      else backRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editingText])

  // Keep the cursor's row in view: a pass fills the column past its own foot
  // within a minute, and a line you can't see is a line you can't time.
  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  useEffect(() => {
    if (editingText) textRef.current?.focus()
  }, [editingText])

  const startTiming = () => {
    const next = retextLyrics(lines, draft)
    onChange(next)
    setCursor(firstUntimed(next))
    setEditingText(false)
  }

  /** Aim at a line: it becomes the next to stamp, and the player goes to its
   *  moment (or the last stamped one before it) so the run-up can be heard. */
  const aim = (i: number) => {
    setCursor(i)
    for (let k = i; k >= 0; k--) {
      const t = lines[k]?.t
      if (t != null) {
        onSeek(t)
        return
      }
    }
    onSeek(0)
  }

  const timedCount = lines.filter((l) => l.t != null).length

  return (
    <div aria-label="Time lyrics" className="flex h-full min-h-0 w-full flex-col">
      <div className="strip flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line/70 px-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
          {editingText ? 'Lyrics text' : 'Time lyrics'}
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Back to the lyric sheet"
          className="btn-ghost btn-sm press shrink-0"
        >
          <X size={12} />
          Done
        </button>
      </div>

      {editingText ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
          <p className="text-[11.5px] leading-snug text-muted">
            One line per lyric line. A blank line clears the screen — put one
            before a solo, or between stanzas that need a breath.
          </p>
          <textarea
            ref={textRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={'Paste the whole lyric here…'}
            aria-label="Lyrics, one line per lyric line"
            spellCheck={false}
            className="field min-h-0 flex-1 resize-none px-2.5 py-2 text-[13px] leading-[1.6]"
          />
          <div className="flex shrink-0 items-center justify-end gap-2">
            {lines.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setDraft(lyricsText(lines))
                  setEditingText(false)
                }}
                className="btn-ghost btn-sm press"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={startTiming}
              disabled={draft.trim() === ''}
              className="btn-signal press px-3 py-1.5 disabled:pointer-events-none disabled:opacity-40"
            >
              {lines.length > 0 ? 'Apply text' : 'Start timing'}
              <ArrowRight size={12} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-line/70 px-3 py-2.5">
            <button
              type="button"
              onClick={stamp}
              disabled={done}
              title={
                done
                  ? 'Every line is timed — click a line to time it again'
                  : `Start line ${cursor + 1} here (${formatTenths(at)}), lead included`
              }
              className="btn-signal press flex w-full items-center justify-center gap-1.5 px-2 py-1.5 disabled:pointer-events-none disabled:opacity-40"
            >
              {done ? 'All lines timed' : 'This line starts here'}
              {/* The key is on the button because that is where it is looked
                  for: a pass is run from the keyboard. */}
              <kbd className="kbd-cap ml-0.5 text-[10px]">→</kbd>
            </button>

            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onPlayPause}
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
                className="btn-ghost btn-sm press shrink-0"
              >
                {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              {/* The moment a press would land on, lead already taken off. */}
              <span
                title="Where a stamp would land right now"
                className="chip chip-time shrink-0 font-mono text-[11px] tabular-nums"
              >
                {formatTenths(at)}
              </span>
              <label
                className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted"
                title="Stamps land this many seconds earlier than the press — you always react after the line starts, not before"
              >
                Lead
                <input
                  type="number"
                  min={0}
                  max={3}
                  step={0.1}
                  value={lead}
                  onChange={(e) =>
                    setLead(Math.min(3, Math.max(0, Number(e.target.value) || 0)))
                  }
                  aria-label="Lead offset in seconds"
                  className="field w-[58px] px-1.5 py-1 text-center text-[11px]"
                />
                s
              </label>
            </div>
            <p className="mt-2 text-[10.5px] leading-snug text-muted">
              <kbd className="kbd-cap text-[10px]">←</kbd> steps back a line without
              stamping. Click any line to time it again from there.
            </p>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {lines.map((line, i) => {
              const isCursor = i === cursor
              const rest = line.text === ''
              return (
                <li
                  key={i}
                  ref={isCursor ? cursorRef : undefined}
                  className={`flex h-8 items-center gap-2 rounded pl-1.5 pr-2 ${
                    isCursor
                      ? 'bg-rowsel text-fg'
                      : line.t != null
                        ? 'text-fg hover:bg-raised'
                        : 'text-muted hover:bg-raised hover:text-fg'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => aim(i)}
                    aria-current={isCursor ? 'true' : undefined}
                    title={
                      line.t != null
                        ? `Starts at ${formatTenths(line.t)} — click to time it again`
                        : 'Click to make this the next line to time'
                    }
                    className="press flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
                  >
                    <span
                      className={`w-[52px] shrink-0 font-mono text-[10.5px] tabular-nums ${
                        line.t == null ? 'opacity-50' : ''
                      }`}
                    >
                      {line.t != null ? formatTenths(line.t) : '—'}
                    </span>
                    <span
                      className={`min-w-0 flex-1 truncate text-[12.5px] ${
                        rest ? 'italic opacity-60' : ''
                      }`}
                    >
                      {rest ? '(clears the screen)' : line.text}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line/70 px-3 py-2">
            <span className="shrink-0 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              {timedCount}/{lines.length} timed
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setDraft(lyricsText(lines))
                  setEditingText(true)
                }}
                title="Change the words — lines that keep their words keep their times"
                className="btn-ghost btn-sm press shrink-0"
              >
                <Pencil size={12} />
                Edit text
              </button>
              {timedCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(clearAllTimes(lines))
                    setCursor(0)
                  }}
                  title="Forget every stamp and keep the words"
                  className="btn-ghost btn-sm press shrink-0 text-danger"
                >
                  <Trash2 size={12} />
                  Clear times
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
