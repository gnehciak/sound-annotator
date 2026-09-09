import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Minus, Plus, Trash2, X } from 'lucide-react'
import type { ScoreTurn } from '../types'
import { formatTenths, formatTime } from '../lib/format'
import { addTurn, nudgeTurn, removeTurn } from '../lib/score'
import { isTypingTarget } from '../lib/useHotkeys'

/** The one key that stamps a turn — see the listener below. */
const TURN_KEY = 't'

/**
 * The sync workspace: teach the score when to turn its own pages.
 *
 * One button does the whole job, which is why there is no separate "record"
 * mode. Press play and hit **Turn here** at each page turn and you have made
 * a live pass; pause, scrub to a moment and hit it and you have placed a
 * single turn by hand. The second is how a wrong turn gets fixed — nobody
 * should have to replay eight minutes to move page 12 — and for a long score
 * it is faster than any live pass anyway.
 *
 * The lead offset is what makes the live pass usable: the press always lands
 * after the moment it marks, by roughly a constant, so the stamp goes in that
 * much earlier. Raising it until the turns feel right is one number, not
 * twenty nudges.
 *
 * **It stands beside the score, not under it.** A strip along the foot had to
 * wrap its turns, and a long score wraps them into four or five rows that push
 * the music up out of the panel — exactly while the reader is watching the
 * page they are timing. A column holds one turn per line however many there
 * are, scrolls on its own, and takes its width off a page that had spare width
 * to give: a portrait page fitted to a landscape screen leaves the room this
 * panel wants.
 *
 * **`T` is the same press as the button**, which is the point of it: during a
 * live pass the hand that would be on the mouse is better spent on the
 * keyboard, and hunting for a button between page turns is how a pass goes
 * wrong. The listener is capture-phase so the app's global hotkeys never see
 * the key, and it stands down inside the lead field like every other shortcut.
 */
export default function ScoreSync({
  turns,
  page,
  pageCount,
  currentTime,
  lead,
  onLead,
  onTurns,
  onSeek,
  onPage,
  onClose,
}: {
  turns: ScoreTurn[]
  /** The page on screen — the one a turn is stamped *away from*. */
  page: number
  pageCount: number
  /** Clip time, the clock every turn is written in. */
  currentTime: number
  lead: number
  onLead: (seconds: number) => void
  onTurns: (turns: ScoreTurn[]) => void
  onSeek: (t: number) => void
  onPage: (page: number) => void
  onClose: () => void
}) {
  // Which turn the nudge/delete controls act on. Cleared whenever the list
  // changes shape under it, so the controls can never point at a turn that
  // has moved somewhere else in the list.
  const [selected, setSelected] = useState<number | null>(null)
  // The turn just stamped, so the list can scroll to it. A live pass fills the
  // column past its own foot within a minute, and a turn you can't see is a
  // turn you can't tell went in.
  const [added, setAdded] = useState<string | null>(null)
  const addedRef = useRef<HTMLButtonElement | null>(null)

  const next = Math.min(page + 1, pageCount)
  const canTurn = next > page
  const at = Math.max(0, currentTime - lead)

  const stamp = useCallback(() => {
    if (!canTurn) return
    onTurns(addTurn(turns, at, next))
    onPage(next)
    setSelected(null)
    setAdded(`${at}-${next}`)
  }, [canTurn, onTurns, turns, at, next, onPage])

  // Read through a ref so the listener subscribes once: `stamp` closes over the
  // playhead and is therefore a new function on every tick of the clock.
  const stampRef = useRef(stamp)
  useLayoutEffect(() => {
    stampRef.current = stamp
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.key.toLowerCase() !== TURN_KEY) return
      // The lead field is a text field: typing a number there must not stamp.
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      stampRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    if (added) addedRef.current?.scrollIntoView({ block: 'nearest' })
  }, [added])

  const act = (nextTurns: ScoreTurn[]) => {
    onTurns(nextTurns)
    setSelected(null)
  }

  /**
   * Nudge the selected turn and *keep* it selected — retiming is iterative, and
   * a control that deselects after every tap would make the second half-second
   * cost a round trip through the list. The index is re-found rather than
   * reused: a nudge past a neighbour re-sorts the list under it.
   */
  const nudge = (by: number) => {
    if (selected == null) return
    const target = turns[selected]
    if (!target) return
    const nextTurns = nudgeTurn(turns, selected, by)
    onTurns(nextTurns)
    const movedTo = Math.max(0, target.t + by)
    const found = nextTurns.findIndex(
      (x) => x.page === target.page && Math.abs(x.t - movedTo) < 1e-6,
    )
    setSelected(found === -1 ? null : found)
  }

  return (
    <aside
      aria-label="Page turn sync"
      // Beside the score on a landscape screen, under it on a narrow one —
      // where a column would leave the page a slot too thin to read.
      className="glass-strip flex max-h-[46%] w-full shrink-0 flex-col border-t border-line sm:max-h-none sm:w-[288px] sm:border-l sm:border-t-0"
    >
      <div className="strip flex h-10 shrink-0 items-center justify-between gap-2 border-b border-line/70 px-3">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
          Page turns
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Done syncing"
          className="btn-ghost btn-sm press shrink-0"
        >
          <X size={12} />
          Done
        </button>
      </div>

      <div className="shrink-0 border-b border-line/70 px-3 py-2.5">
        <button
          type="button"
          onClick={stamp}
          disabled={!canTurn}
          title={
            canTurn
              ? `Mark page ${next} as starting here (${formatTenths(at)}), lead included`
              : 'The last page has nowhere to turn to'
          }
          className="btn-signal press flex w-full items-center justify-center gap-1.5 px-2 py-1.5 disabled:pointer-events-none disabled:opacity-40"
        >
          <Check size={12} />
          Turn here → page {next}
          {/* The key is on the button because that is where it is looked for:
              a live pass is run from the keyboard, and nothing else on screen
              would say so. */}
          <kbd className="kbd-cap ml-0.5 text-[10px]">T</kbd>
        </button>

        <div className="mt-2 flex items-center justify-between gap-2">
          {/* The moment a press would land on, lead already taken off. The
              transport's own clock hides itself during playback — which is
              exactly when a live pass needs to see one. */}
          <span
            title="Where a turn would land right now"
            className="chip chip-time shrink-0 font-mono text-[11px] tabular-nums"
          >
            {formatTenths(at)}
          </span>

          <label
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted"
            title="Stamps land this many seconds earlier than the press — you always react after the moment, not before it"
          >
            Lead
            <input
              type="number"
              min={0}
              max={3}
              step={0.1}
              value={lead}
              onChange={(e) => onLead(Math.min(3, Math.max(0, Number(e.target.value) || 0)))}
              aria-label="Lead offset in seconds"
              className="field w-[58px] px-1.5 py-1 text-center text-[11px]"
            />
            s
          </label>
        </div>
      </div>

      {/* The turns themselves: click one to jump there and take aim at it. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {turns.length === 0 ? (
          <p className="px-1 text-[11px] leading-snug text-muted">
            No page turns yet. Play, and press <strong>Turn here</strong> (or{' '}
            <kbd className="kbd-cap text-[10px]">T</kbd>) as each page ends — or
            pause, scrub to the moment, and press it there.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {turns.map((turn, i) => {
              const key = `${turn.t}-${turn.page}`
              const sel = i === selected
              return (
                <li key={key}>
                  <button
                    type="button"
                    ref={added === key ? addedRef : undefined}
                    onClick={() => {
                      onSeek(turn.t)
                      onPage(turn.page)
                      setSelected(sel ? null : i)
                    }}
                    aria-pressed={sel}
                    title={`Page ${turn.page} from ${formatTime(turn.t)} — click to hear it`}
                    className={`press flex w-full items-center gap-2 px-2 py-1.5 text-left ${
                      sel
                        ? 'rounded-t bg-rowsel text-fg'
                        : 'rounded text-muted hover:bg-raised hover:text-fg'
                    }`}
                  >
                    <span className="w-9 shrink-0 font-mono text-[10px] uppercase tracking-[0.14em]">
                      p{turn.page}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums">
                      {formatTime(turn.t)}
                    </span>
                  </button>

                  {/* The retiming controls belong to the selected turn, so they
                      sit under it rather than in a corner of the panel: which
                      turn a nudge moves is then the row it is drawn inside. */}
                  {sel && (
                    <div className="flex items-center gap-1 rounded-b bg-rowsel px-2 pb-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => nudge(-0.5)}
                        title="Half a second earlier"
                        aria-label="Move this turn half a second earlier"
                        className="btn-icon press"
                      >
                        <Minus size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => nudge(0.5)}
                        title="Half a second later"
                        aria-label="Move this turn half a second later"
                        className="btn-icon press"
                      >
                        <Plus size={12} />
                      </button>
                      <span className="text-[10px] text-muted">±0.5s</span>
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => act(removeTurn(turns, selected))}
                        title="Delete this turn"
                        aria-label="Delete this turn"
                        className="btn-icon press text-danger"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {turns.length > 0 && (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line/70 px-3 py-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
            {turns.length} turn{turns.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={() => {
              act([])
              // Back to page 1 as well: clearing while parked on the last page
              // would otherwise leave the one button that matters disabled,
              // with nothing on screen saying why.
              onPage(1)
            }}
            title="Delete every page turn on this score"
            className="btn-ghost btn-sm press shrink-0 text-danger"
          >
            <Trash2 size={12} />
            Clear all
          </button>
        </div>
      )}
    </aside>
  )
}
