import { MonitorPlay, ScrollText } from 'lucide-react'
import type { ScoreMode } from '../types'

/**
 * Which of the two things the player column is showing: the player, or the
 * score.
 *
 * A view switch rather than a "show the score" toggle because that is what it
 * is — the score is not a layer over the picture (it has its own switch for
 * that, in the score menu) but a second view of the same column, and the two
 * are peers. Only rendered when the track actually has a score: a column with
 * one view has nothing to switch between.
 *
 * Switching is not a save for a reader — the host turns it into a session
 * override — so a student flipping to the score on a shared track changes
 * nothing for anyone else.
 */
export default function ScoreViewSwitch({
  mode,
  onMode,
}: {
  mode: ScoreMode
  onMode: (mode: ScoreMode) => void
}) {
  return (
    <div className="seg shrink-0" role="group" aria-label="Player or score">
      <button
        type="button"
        onClick={() => onMode('off')}
        aria-pressed={mode === 'off'}
        title="The player"
        className="seg-item px-2"
      >
        <MonitorPlay size={12} />
        Player
      </button>
      <button
        type="button"
        onClick={() => onMode('view')}
        aria-pressed={mode === 'view'}
        title="The score — read the printed music while it plays"
        className="seg-item px-2"
      >
        <ScrollText size={12} />
        Score
      </button>
    </div>
  )
}
