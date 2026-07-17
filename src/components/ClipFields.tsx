import { Scissors } from 'lucide-react'
import type { ClipDraft } from '../lib/clip'

/**
 * The start/end pair that trims a YouTube track to an excerpt. Deliberately
 * text, not a scrubber: a teacher clipping a movement or a chorus is reading
 * the times off a score or the video itself, and typing "1:30" beats dragging
 * for a frame.
 */
export default function ClipFields({
  value,
  onChange,
  error,
  onCommit,
}: {
  value: ClipDraft
  onChange: (draft: ClipDraft) => void
  error?: string | null
  /** Called on blur / Enter, when the caller applies rather than submits. */
  onCommit?: () => void
}) {
  const field = (key: keyof ClipDraft, label: string, placeholder: string) => (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </span>
      <input
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onCommit) {
            e.preventDefault()
            onCommit()
          }
        }}
        placeholder={placeholder}
        inputMode="numeric"
        aria-label={`Clip ${label.toLowerCase()} time`}
        className="w-[72px] rounded border border-line bg-inset px-2 py-1 text-center font-mono text-[12px] text-fg placeholder:text-muted focus:border-accent"
      />
    </label>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center text-muted">
          <Scissors size={13} />
        </span>
        {field('start', 'From', '0:00')}
        {field('end', 'To', 'end')}
        <span className="text-[11.5px] leading-snug text-muted">
          Optional — leave blank for the whole video.
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 pl-[26px] text-[11.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
