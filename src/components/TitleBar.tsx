import type { ReactNode } from 'react'

/**
 * The panel header used atop both columns of the player|notes split (and the
 * docked inspector). A left label, optional right readout, and an optional
 * `actions` slot for inline controls (e.g. the notes filter/sort switches).
 * Shared by the editor (App) and the read-only ShareViewer so both columns
 * read identically.
 */
export default function TitleBar({
  left,
  right,
  actions,
}: {
  left: string
  right?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-raised/60 px-3">
      <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
        {left}
      </span>
      <div className="flex min-w-0 items-center gap-3">
        {actions}
        {right && (
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted">
            {right}
          </span>
        )}
      </div>
    </div>
  )
}
