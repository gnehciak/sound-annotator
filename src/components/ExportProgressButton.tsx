import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { ProgressFn } from '../lib/quoteImages'

interface Props {
  label: string
  icon: ReactNode
  title: string
  /** The export to run. It reports how far along it is; see ProgressFn. */
  run: (onProgress: ProgressFn) => Promise<void>
  /** `btn-sm` inside the share menu, full size on the sub-bar. */
  small?: boolean
}

/**
 * The shape both document exports wear: a button that becomes a progress bar
 * while it works.
 *
 * Worth the component rather than a spinner, because the wait is real and
 * uneven — a track whose notes quote a long score has to fetch it and
 * rasterise a page per quoted page at print resolution, which is seconds each.
 * A spinner says "something is happening"; the bar says how much is left, and
 * the tooltip says which page it is on, which is the difference between
 * waiting and giving up. (The PDF's own tab carries the same bar in bigger
 * type — this is for the press that started it, and it is the only progress
 * the Word export has, since that one never opens a tab.)
 */
export default function ExportProgressButton({
  label,
  icon,
  title,
  run,
  small,
}: Props) {
  const [progress, setProgress] = useState<{ value: number; label: string } | null>(
    null,
  )
  const busy = progress != null

  const start = async () => {
    if (busy) return
    setProgress({ value: 0, label: 'Starting' })
    try {
      await run((value, step) => setProgress({ value, label: step }))
    } finally {
      setProgress(null)
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void start()}
      title={busy ? `${progress.label}…` : title}
      aria-busy={busy || undefined}
      className={`btn-ghost press relative shrink-0 overflow-hidden ${
        small ? 'btn-sm' : ''
      } disabled:opacity-100`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}
      <span className={small ? '' : 'hidden sm:inline'}>{label}</span>
      {/* A rule along the foot rather than a bar of its own: the control keeps
          its size and its place, and the fill is the only thing that moves. */}
      {busy && (
        <span
          aria-hidden
          style={{ width: `${Math.round(Math.min(1, progress.value) * 100)}%` }}
          className="absolute inset-x-0 bottom-0 h-[2px] bg-accent transition-[width] duration-300"
        />
      )}
    </button>
  )
}
