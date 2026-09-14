import { useRef, useState } from 'react'
import { Download, Loader2, Scissors } from 'lucide-react'
import Popover from './Popover'
import { ApiError } from '../lib/api'
import {
  clipRangeError,
  downloadClip,
  seedRange,
  type ClipRange,
} from '../lib/clipDownload'
import { formatTime, parseTime } from '../lib/format'

/**
 * The clip export — a passage of the track's audio as an m4a file, for a
 * student to drop into a presentation. Two presentations of one row:
 * `ClipExportRow` sits inline in the editor's share/export menu, and
 * `ClipExportButton` wraps it in a popover for the share viewer's sub-bar,
 * where a reader has no menu.
 *
 * Text fields rather than a scrubber, like the clip window's own
 * (`ClipFields`): the passage is read off the notes or the score and typed.
 * Seeded from wherever the caller says — the note open in the inspector, or
 * thirty seconds from the playhead — so the common case is one press. Range
 * notes carry their own one-press download on the row (AnnotationItem); this
 * is for a passage no note brackets.
 */
export function ClipExportRow({
  project,
  initial,
  duration,
  onDone,
}: {
  project: { id: string; title: string }
  /** Where the fields start out. Read once, on mount. */
  initial: ClipRange
  duration: number
  /** The download has been handed to the browser. */
  onDone?: () => void
}) {
  const [draft, setDraft] = useState({
    start: formatTime(initial.start),
    end: formatTime(initial.end),
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async () => {
    if (busy) return
    const start = parseTime(draft.start)
    const end = parseTime(draft.end)
    const range = start != null && end != null ? { start, end } : null
    const problem = range
      ? clipRangeError(range, duration)
      : 'Times should look like 1:30 (or 90).'
    if (!range || problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await downloadClip(project, range)
      onDone?.()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The clip could not be made.')
    } finally {
      setBusy(false)
    }
  }

  const field = (key: 'start' | 'end', label: string) => (
    <label className="flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      <input
        value={draft[key]}
        onChange={(e) => {
          setError(null)
          setDraft({ ...draft, [key]: e.target.value })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void go()
          }
        }}
        placeholder="0:00"
        inputMode="numeric"
        aria-label={`Clip ${label.toLowerCase()} time`}
        className="field w-[64px] px-2 py-1 text-center font-mono text-[12px]"
      />
    </label>
  )

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {field('start', 'From')}
        {field('end', 'To')}
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          aria-busy={busy || undefined}
          title="Download this passage of the audio as an m4a file"
          className="btn-signal btn-sm press disabled:opacity-100"
        >
          {busy ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Download size={12} />
          )}
          {busy ? 'Cutting…' : 'Download'}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-[11.5px] leading-snug text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function ClipExportButton({
  project,
  currentTime,
  duration,
}: {
  project: { id: string; title: string }
  currentTime: number
  duration: number
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Download a passage of the audio as an m4a clip"
        className="btn-ghost press shrink-0"
      >
        <Scissors size={12} />
        <span className="hidden sm:inline">Clip</span>
      </button>
      <Popover
        open={open}
        anchorRef={anchor}
        onClose={() => setOpen(false)}
        width={320}
        className="p-3.5"
      >
        <p className="mb-2.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
          Audio clip
        </p>
        {/* Mounted per open, so the fields re-seed from the playhead. */}
        {open && (
          <ClipExportRow
            project={project}
            initial={seedRange(currentTime, duration)}
            duration={duration}
            onDone={() => setOpen(false)}
          />
        )}
      </Popover>
    </>
  )
}
