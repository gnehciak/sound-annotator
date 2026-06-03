import { X } from 'lucide-react'

const GROUPS = [
  {
    title: 'Transport',
    items: [
      { keys: ['Space'], label: 'Play / pause' },
      { keys: ['←', '→'], label: 'Seek 5 seconds' },
      { keys: ['⇧', '←', '→'], label: 'Seek 30 seconds' },
    ],
  },
  {
    title: 'Notes',
    items: [
      { keys: ['N'], label: 'Add note at current time' },
      { keys: ['I'], label: 'Mark section start' },
      { keys: ['O'], label: 'Mark section end' },
      { keys: ['↑', '↓'], label: 'Previous / next note' },
    ],
  },
  {
    title: 'Navigation',
    items: [
      { keys: ['Home', 'End'], label: 'Jump to start / end' },
      { keys: ['['], label: 'Toggle track list' },
      { keys: ['V'], label: 'Toggle view-only mode' },
      { keys: ['?'], label: 'Show this help' },
    ],
  },
]

export default function ShortcutsOverlay({
  onClose,
  closing = false,
}: {
  onClose: () => void
  closing?: boolean
}) {
  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4 ${
        closing ? 'animate-fade-out' : 'animate-fade-in'
      }`}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg rounded border border-line bg-panel shadow-2xl ${
          closing ? 'animate-panel-out' : 'animate-panel-in'
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
            Keyboard Shortcuts
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted hover:bg-raised hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-x-8 gap-y-5 p-4 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
                {g.title}
              </div>
              <ul className="space-y-1.5">
                {g.items.map((it) => (
                  <li
                    key={it.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-xs text-fg">{it.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {it.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-line bg-inset px-1.5 py-0.5 font-mono text-[11px] leading-none text-muted"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-line px-4 py-2 text-center font-mono text-[10px] text-muted">
          Press{' '}
          <kbd className="rounded border border-line bg-inset px-1 leading-none">
            ?
          </kbd>{' '}
          or{' '}
          <kbd className="rounded border border-line bg-inset px-1 leading-none">
            Esc
          </kbd>{' '}
          to close
        </div>
      </div>
    </div>
  )
}
