import { useEffect, type ReactNode } from 'react'
import { PanelRight, Maximize2, X } from 'lucide-react'

export type WindowMode = 'dock' | 'modal'

interface Props {
  /** Uppercase mono title, e.g. the plugin label. */
  title: string
  /** Optional right-of-title detail, e.g. the note's timecode. */
  subtitle?: string
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
  subtitle,
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
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-raised/60 px-3">
      <span className="truncate font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
        {title}
      </span>
      {subtitle && (
        <span className="shrink-0 font-mono text-[11px] tracking-wider text-accent">
          {subtitle}
        </span>
      )}
      <div className="flex-1" />
      <ModeButton
        active={mode === 'dock'}
        title="Dock to the side — keeps playback live"
        onClick={() => onSetMode('dock')}
        icon={<PanelRight size={14} />}
      />
      <ModeButton
        active={mode === 'modal'}
        title="Open as a focused window — pauses playback"
        onClick={() => onSetMode('modal')}
        icon={<Maximize2 size={13} />}
      />
      {onClose && (
        <>
          <span className="mx-0.5 h-3.5 w-px bg-line" />
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="press rounded p-1 text-muted hover:text-fg"
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
        className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-ink/70 p-6"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose?.()
        }}
      >
        <div
          role="dialog"
          aria-label={title}
          className="flex max-h-[80vh] w-full max-w-lg flex-col border border-line-strong bg-panel"
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
      className="flex h-full min-h-0 flex-col border-l border-line bg-panel"
    >
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

function ModeButton({
  active,
  title,
  onClick,
  icon,
}: {
  active: boolean
  title: string
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`press rounded p-1 ${
        active ? 'bg-raised text-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {icon}
    </button>
  )
}
