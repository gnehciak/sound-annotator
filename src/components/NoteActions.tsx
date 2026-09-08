import { ChevronFirst, ChevronLast, Plus, X } from 'lucide-react'
import { formatTime } from '../lib/format'

interface Props {
  pendingIn: number | null
  currentTime: number
  onMarkIn: () => void
  onMarkOut: () => void
  onCancelMark: () => void
  /** Add a note at the live current time (the N shortcut). */
  onAddNote: () => void
}

// Note-creation actions, docked as a strip beneath the Notes header — that's
// where adding a note reads as the natural next step. Mark start / Add note /
// Mark end sit in three equal columns (minmax(0,1fr)) so each keeps a fixed
// width regardless of contents; the Start cancel (X) lives inside column 1, so
// it eats into Start's own width rather than shifting Add note / Mark end.
//
// Add note is a plain button, not a menu: it adds at the current moment, and
// the time it will use is printed on it. A note's time is editable in the note
// itself, so a second way to type one here was a menu whose only item repeated
// the button that opened it.
export default function NoteActions({
  pendingIn,
  currentTime,
  onMarkIn,
  onMarkOut,
  onCancelMark,
  onAddNote,
}: Props) {
  return (
    <div className="border-b border-line/70 px-3 py-2.5">
      <div className="grid grid-cols-3 items-stretch gap-[7px]">
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={onMarkIn}
            title="Mark where a section starts (at the current time). Then mark the end to add a note covering that whole part. (I)"
            aria-label="Mark section start"
            className={
              pendingIn != null
                ? 'btn-signal press min-w-0 flex-1 gap-[5px] rounded-r-none px-2 font-medium tracking-[0.08em]'
                : 'btn-ghost press min-w-0 flex-1 gap-[5px] px-2 font-medium tracking-[0.08em]'
            }
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
              className="btn-signal press shrink-0 rounded-l-none border-l-0 px-1.5"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <button
          onClick={onAddNote}
          title="Add a note at the current moment (N)"
          className="btn-signal press min-w-0 px-2"
        >
          <Plus size={13} className="shrink-0" />
          <span className="truncate">Add note</span>
          <span className="shrink-0 tabular-nums tracking-[0.02em] opacity-75">
            ({formatTime(currentTime)})
          </span>
        </button>

        <button
          onClick={onMarkOut}
          disabled={pendingIn == null}
          title="Mark where the section ends, and add a note for that whole part (O)"
          aria-label="Mark section end and add the note"
          className="btn-ghost press min-w-0 gap-[5px] px-2 font-medium tracking-[0.08em]"
        >
          Mark end <ChevronLast size={13} />
        </button>
      </div>
    </div>
  )
}
