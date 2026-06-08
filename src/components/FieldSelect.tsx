import { useRef, useState, type ReactNode } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import Popover from './Popover'

interface Props {
  label: string
  value?: string
  options: string[]
  allowCustom?: boolean
  readOnly?: boolean
  onChange: (value: string | undefined) => void
}

/**
 * A labelled, inset dropdown in the Listening Station style (no native <select>,
 * to match TagPicker/ColorPicker). Picks from `options`, with an optional
 * "Other…" free-text entry when `allowCustom`. The menu is portalled (see
 * Popover) so it's never clipped by the scrolling plugin-window body.
 */
export default function FieldSelect({
  label,
  value,
  options,
  allowCustom,
  readOnly,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Seed the custom field with the current non-preset value when opening.
  const openMenu = () => {
    setCustom(value && !options.includes(value) ? value : '')
    setOpen(true)
  }

  const pick = (v: string | undefined) => {
    onChange(v)
    setOpen(false)
  }
  const commitCustom = () => {
    const v = custom.trim()
    if (v) pick(v)
  }

  if (readOnly) {
    return (
      <div className="min-w-0">
        <FieldLabel>{label}</FieldLabel>
        <div className="truncate px-1 py-1.5 text-[12px] text-fg">
          {value || <span className="text-muted">—</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`bevel-inset flex w-full items-center gap-1 rounded border border-line bg-inset px-[9px] py-[6px] text-left text-[12.5px] transition-colors focus:border-accent focus:outline-none ${
          value ? 'text-fg' : 'text-muted'
        }`}
      >
        <span className="flex-1 truncate">{value || 'Select…'}</span>
        <ChevronDown size={13} className="shrink-0 text-muted" />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width="anchor"
        className="max-h-60 min-w-[10rem] origin-top overflow-y-auto rounded border border-line bg-panel py-1 shadow-lg"
      >
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => pick(opt)}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-raised ${
              value === opt ? 'text-fg' : 'text-muted'
            }`}
          >
            <Check
              size={12}
              className={value === opt ? 'text-accentink' : 'opacity-0'}
            />
            {opt}
          </button>
        ))}

        {allowCustom && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              commitCustom()
            }}
            className="mt-1 border-t border-line px-2 pb-1 pt-1.5"
          >
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Other…"
              aria-label={`Custom ${label}`}
              className="w-full rounded border border-line bg-inset px-2 py-1.5 text-[12px] text-fg placeholder:text-muted focus:border-accent focus:outline-none"
            />
          </form>
        )}

        {value && (
          <button
            type="button"
            onClick={() => pick(undefined)}
            className="mt-1 flex w-full items-center border-t border-line px-2.5 py-1.5 text-left font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted hover:bg-raised"
          >
            Clear
          </button>
        )}
      </Popover>
    </div>
  )
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
      {children}
    </div>
  )
}
