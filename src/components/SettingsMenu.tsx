import { useRef, useState } from 'react'
import { Settings as SettingsIcon, SlidersHorizontal } from 'lucide-react'
import Popover from './Popover'
import { ThemeMenuContent, type ThemeMenuProps } from './ThemeToggle'

/**
 * The editor bar's one settings control: a gear opening a popover that holds
 * the theme axes (mode + palette — the standalone ThemeToggle stays on the
 * home header only) and, when this track's settings are editable, the entry
 * into the track settings modal.
 */
export default function SettingsMenu({
  theme,
  canEditTrack,
  onOpenTrackSettings,
}: {
  theme: Omit<ThemeMenuProps, 'onAfterPick'>
  /** Owner with edit rights on a non-structure track — shows "Track settings…". */
  canEditTrack: boolean
  onOpenTrackSettings: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-label="Open settings menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`press grid h-8 w-8 shrink-0 place-items-center rounded transition-colors ${
          open ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg'
        }`}
      >
        <SettingsIcon size={16} />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={200}
        className="rounded border border-line bg-panel py-1 shadow-lg"
      >
        {canEditTrack && (
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onOpenTrackSettings()
            }}
            className="mb-1 flex w-full items-center gap-2 border-b border-line px-2.5 py-2 text-left text-[12px] text-fg hover:bg-raised"
          >
            <SlidersHorizontal size={13} className="text-muted" />
            Track settings…
          </button>
        )}
        <ThemeMenuContent {...theme} onAfterPick={() => setOpen(false)} />
      </Popover>
    </>
  )
}
