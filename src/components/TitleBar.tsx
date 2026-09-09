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
  center,
  right,
  actions,
}: {
  left: string
  /**
   * A control centred on the bar itself, not in the actions row — for the one
   * thing that says *what this pane is showing* rather than acting on it (the
   * player|score view switch). Centred against the bar rather than laid out
   * between the two sides, so it doesn't drift when a label or an action
   * appears beside it.
   */
  center?: ReactNode
  right?: string
  actions?: ReactNode
}) {
  return (
    <div className="relative flex h-10 shrink-0 items-center justify-between gap-2.5 border-b border-line/70 bg-fg/[0.03] px-3.5">
      <span className="shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        {left}
      </span>
      {center && (
        <div className="pointer-events-none absolute inset-x-0 flex justify-center">
          <div className="pointer-events-auto">{center}</div>
        </div>
      )}
      <div className="flex min-w-0 items-center gap-1.5">
        {actions}
        {right && (
          <span className="shrink-0 font-mono text-[11px] uppercase tabular-nums tracking-wider text-muted">
            {right}
          </span>
        )}
      </div>
    </div>
  )
}
