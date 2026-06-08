import { useRef, useState } from 'react'
import { ChevronFirst, ChevronLast, Plus, X } from 'lucide-react'
import { formatTime, parseTime } from '../lib/format'
import Popover from './Popover'

interface Props {
  pendingIn: number | null
  currentTime: number
  onMarkIn: () => void
  onMarkOut: () => void
  onCancelMark: () => void
  /** Add a note at the live current time (the N shortcut, and the "now" action). */
  onAddNote: () => void
  /** Add a note at an explicit start (and optional end for a range). */
  onAddNoteAt: (start: number, end?: number) => void
}

// Note-creation actions, docked as a strip beneath the Notes header — that's
// where adding a note reads as the natural next step. Mark start / Add note /
// Mark end sit in three equal columns (minmax(0,1fr)) so each keeps a fixed
// width regardless of contents; the Start cancel (X) lives inside column 1, so
// it eats into Start's own width rather than shifting Add note / Mark end.
export default function NoteActions({
  pendingIn,
  currentTime,
  onMarkIn,
  onMarkOut,
  onCancelMark,
  onAddNote,
  onAddNoteAt,
}: Props) {
  const [open, setOpen] = useState(false)
  const [startStr, setStartStr] = useState('')
  const [endStr, setEndStr] = useState('')
  const addRef = useRef<HTMLButtonElement>(null)

  const openMenu = () => {
    setStartStr(formatTime(currentTime))
    setEndStr('')
    setOpen(true)
  }

  const start = parseTime(startStr)
  const endProvided = endStr.trim() !== ''
  const end = endProvided ? parseTime(endStr) : null
  const customValid =
    start != null && (!endProvided || (end != null && end > start))

  const submitCustom = () => {
    if (!customValid || start == null) return
    onAddNoteAt(start, end != null ? end : undefined)
    setOpen(false)
  }

  const timeInput =
    'bevel-inset w-full rounded border border-line bg-inset px-1.5 py-1.5 text-center font-mono text-[12px] text-fg placeholder:text-muted focus:border-accent focus:outline-none'

  return (
    <div className="border-b border-line bg-panel px-3 py-2.5">
      <div className="grid grid-cols-3 items-stretch gap-[7px]">
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={onMarkIn}
            title="Mark where a section starts (at the current time). Then mark the end to add a note covering that whole part. (I)"
            aria-label="Mark section start"
            className={`press inline-flex min-w-0 flex-1 items-center justify-center gap-[5px] border px-2 py-[7px] font-mono text-[10px] font-medium uppercase tracking-[0.08em] ${
              pendingIn != null
                ? 'rounded-l border-accent/70 bg-accent/10 text-accentink'
                : 'rounded border-line text-muted hover:border-line-strong hover:text-fg'
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
              className="press inline-flex shrink-0 items-center justify-center rounded-r border border-l-0 border-accent/70 bg-accent/10 px-1.5 py-[7px] text-accentink hover:bg-accent/20"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <button
          ref={addRef}
          onClick={() => (open ? setOpen(false) : openMenu())}
          title="Add a note — at the current moment (N) or a custom time"
          className="press inline-flex min-w-0 items-center justify-center gap-[5px] rounded border border-accent/70 bg-accent/10 px-2 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accentink hover:bg-accent/20"
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
          className="press inline-flex min-w-0 items-center justify-center gap-[5px] rounded border border-line px-2 py-[7px] font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted hover:border-line-strong hover:text-fg disabled:opacity-35 disabled:hover:border-line disabled:hover:text-muted"
        >
          Mark end <ChevronLast size={13} />
        </button>
      </div>

      <Popover
        open={open}
        anchorRef={addRef}
        onClose={() => setOpen(false)}
        width={252}
        className="origin-top rounded border border-line bg-panel p-2.5 shadow-lg"
      >
        <button
          type="button"
          onClick={() => {
            onAddNote()
            setOpen(false)
          }}
          className="press flex w-full items-center justify-center gap-[5px] rounded border border-accent/70 bg-accent/10 px-2 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accentink hover:bg-accent/20"
        >
          <Plus size={13} /> Add at {formatTime(currentTime)}
          <span className="tabular-nums tracking-[0.02em] opacity-75">(now)</span>
        </button>

        <div className="mb-1 mt-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
          Custom time
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitCustom()
          }}
          className="flex items-end gap-1.5"
        >
          <label className="min-w-0 flex-1">
            <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
              Start
            </span>
            <input
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              placeholder="m:ss"
              inputMode="numeric"
              aria-label="Custom start time"
              className={timeInput}
            />
          </label>
          <span className="pb-1.5 text-muted">–</span>
          <label className="min-w-0 flex-1">
            <span className="mb-0.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
              End
            </span>
            <input
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              placeholder="optional"
              inputMode="numeric"
              aria-label="Custom end time (optional)"
              className={timeInput}
            />
          </label>
          <button
            type="submit"
            disabled={!customValid}
            className="press shrink-0 rounded border border-line px-2.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted hover:border-accent hover:text-accentink disabled:opacity-30 disabled:hover:border-line disabled:hover:text-muted"
          >
            Add
          </button>
        </form>
      </Popover>
    </div>
  )
}
