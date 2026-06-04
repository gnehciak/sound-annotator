import { ChevronFirst, ChevronLast, Plus, X } from 'lucide-react'
import { formatTime } from '../lib/format'

interface Props {
  pendingIn: number | null
  onMarkIn: () => void
  onMarkOut: () => void
  onCancelMark: () => void
  onAddNote: () => void
}

// Note-creation actions, docked as a strip beneath the Notes header — that's
// where adding a note reads as the natural next step. Mark start / Add note /
// Mark end sit in three equal columns (minmax(0,1fr)) so each keeps a fixed
// width regardless of contents; the Start cancel (X) lives inside column 1, so
// it eats into Start's own width rather than shifting Add note / Mark end.
export default function NoteActions({
  pendingIn,
  onMarkIn,
  onMarkOut,
  onCancelMark,
  onAddNote,
}: Props) {
  return (
    <div className="border-b border-line bg-panel p-2">
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
  )
}
