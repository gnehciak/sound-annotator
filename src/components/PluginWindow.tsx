import { useEffect, type ReactNode } from 'react'
import { PanelRight, Maximize2, X } from 'lucide-react'

export type WindowMode = 'dock' | 'modal'

interface Props {
  /** Uppercase mono title, e.g. the plugin label. */
  title: string
  /**
   * Rendered before the title — the plugin's own identity mark, e.g. the
   * note's colour swatch. The title bar is the one row every presentation
   * already pays for, so an identity control belongs here rather than in a
   * row of its own inside the body.
   */
  leading?: ReactNode
  /**
   * Plugin actions, placed before the window-mode buttons and separated by a
   * hairline: the plugin's verbs (delete) sit apart from the window's.
   */
  actions?: ReactNode
  mode: WindowMode
  onSetMode: (mode: WindowMode) => void
  /** When omitted, the close button + Esc-to-close are off (a persistent panel). */
  onClose?: () => void
  children: ReactNode
}

/**
 * The plugin editor window — a note block's editor opens inside this shell in
 * one of two presentations, like a DAW plugin window:
 *
 *  - 'dock'  — a flush, full-height side panel (the app's 3rd column). The host
 *              keeps the transport live, so you can scrub while you edit.
 *  - 'modal' — a centred, blocking overlay for focused entry; the host disables
 *              playback while it's open.
 *
 * Pure chrome (title bar, mode toggle, close, Esc); the plugin supplies the body
 * via `children`. The host decides where to place it (3rd column vs overlay).
 */
export default function PluginWindow({
  title,
  leading,
  actions,
  mode,
  onSetMode,
  onClose,
  children,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Let an open @-mention popup take Escape first (it closes itself).
        if (document.querySelector('[data-mention-popup]')) return
        if (!onClose) return
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const header = (
    <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line/70 bg-fg/[0.03] px-3.5">
      {leading}
      <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        {title}
      </span>
      <div className="flex-1" />
      {actions && (
        <>
          {actions}
          <span className="mx-1.5 h-3.5 w-px bg-line" />
        </>
      )}
      {/* One key for the two presentations, not a two-button radio: it shows
          the view it will *take you to*, so there is no "which of these is
          on?" to read at a glance — and one fewer icon beside the plugin's
          own destructive action. */}
      <button
        type="button"
        role="switch"
        aria-checked={mode === 'modal'}
        onClick={() => onSetMode(mode === 'dock' ? 'modal' : 'dock')}
        title={
          mode === 'dock'
            ? 'Open as a focused window — pauses playback'
            : 'Dock to the side — keeps playback live'
        }
        aria-label={
          mode === 'dock' ? 'Open as a focused window' : 'Dock to the side'
        }
        className="btn-icon press"
      >
        {mode === 'dock' ? <Maximize2 size={13} /> : <PanelRight size={14} />}
      </button>
      {onClose && (
        <>
          <span className="mx-0.5 h-3.5 w-px bg-line" />
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="btn-icon press"
          >
            <X size={15} />
          </button>
        </>
      )}
    </div>
  )

  if (mode === 'modal') {
    return (
      <div
        className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-ink/60 p-6 backdrop-blur-sm"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.()
        }}
      >
        <div
          role="dialog"
          aria-label={title}
          className="glass-pop flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl"
        >
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      </div>
    )
  }

  // 'dock' — meant to be slotted into the layout's 3rd column by the host.
  return (
    <div
      role="dialog"
      aria-label={title}
      className="flex h-full min-h-0 flex-col"
    >
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}
