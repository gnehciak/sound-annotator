import { useState } from 'react'
import { Check, Minus, Plus, Trash2, X } from 'lucide-react'
import type { ScoreTurn } from '../types'
import { formatTime } from '../lib/format'
import { addTurn, nudgeTurn, removeTurn } from '../lib/score'

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
 */
/** A timecode with tenths — a lead offset is a sub-second thing. */
function tenths(seconds: number): string {
  const whole = Math.floor(Math.max(0, seconds))
  return `${formatTime(whole)}.${Math.floor((Math.max(0, seconds) - whole) * 10)}`
}

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

  const next = Math.min(page + 1, pageCount)
  const canTurn = next > page
  const at = Math.max(0, currentTime - lead)

  const stamp = () => {
    onTurns(addTurn(turns, at, next))
    onPage(next)
    setSelected(null)
  }

  const act = (nextTurns: ScoreTurn[]) => {
    onTurns(nextTurns)
    setSelected(null)
  }

  /**
   * Nudge the selected turn and *keep* it selected — retiming is iterative, and
   * a control that deselects after every tap would make the second half-second
   * cost a round trip through the rail. The index is re-found rather than
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
    <div className="glass-pop shrink-0 border-t border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={stamp}
          disabled={!canTurn}
          title={
            canTurn
              ? `Mark page ${next} as starting here (${tenths(at)}), lead included`
              : 'The last page has nowhere to turn to'
          }
          className="btn-signal btn-sm press shrink-0 disabled:pointer-events-none disabled:opacity-40"
        >
          <Check size={12} />
          Turn here → page {next}
        </button>

        {/* The moment a press would land on, lead already taken off. The
            transport's own clock hides itself during playback — which is
            exactly when a live pass needs to see one. */}
        <span
          title="Where a turn would land right now"
          className="chip chip-time shrink-0 font-mono text-[11px] tabular-nums"
        >
          {tenths(at)}
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
            className="field w-[62px] px-1.5 py-1 text-center text-[11px]"
          />
          s
        </label>

        <span className="flex-1" />

        {turns.length > 0 && (
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
        )}
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

      {/* The turns themselves: click one to jump there and take aim at it. */}
      <div className="mt-2 flex items-center gap-2">
        {turns.length === 0 ? (
          <p className="text-[11px] leading-snug text-muted">
            No page turns yet. Play, and press <strong>Turn here</strong> as each
            page ends — or pause, scrub to the moment, and press it there.
          </p>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            {turns.map((turn, i) => (
              <button
                key={`${turn.t}-${turn.page}`}
                type="button"
                onClick={() => {
                  onSeek(turn.t)
                  onPage(turn.page)
                  setSelected(i === selected ? null : i)
                }}
                aria-pressed={i === selected}
                title={`Page ${turn.page} from ${formatTime(turn.t)} — click to hear it`}
                className={`chip press shrink-0 font-mono text-[10px] ${
                  i === selected ? 'chip-signal' : 'chip-outline'
                }`}
              >
                p{turn.page} · {formatTime(turn.t)}
              </button>
            ))}
          </div>
        )}

        {selected != null && turns[selected] && (
          <div className="flex shrink-0 items-center gap-1 border-l border-line pl-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              p{turns[selected].page}
            </span>
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
      </div>
    </div>
  )
}
