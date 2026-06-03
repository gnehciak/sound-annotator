import { useEffect, useRef, useState } from 'react'
import { PRESET_COLORS } from '../lib/noteColors'
import { usePresence } from '../lib/usePresence'

interface Props {
  color: string
  onChange: (color: string | undefined) => void
}

export default function ColorPicker({ color, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const pop = usePresence(open)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    // stop clicks from toggling the note's expand state
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Note colour"
        aria-label="Note colour"
        className="press h-4 w-4 shrink-0 rounded-full border border-line hover:border-line-strong"
        style={{ background: color }}
      />

      {pop.mounted && (
        <div
          className={`absolute left-0 top-full z-20 mt-1 w-44 origin-top-left rounded border border-line bg-panel p-2 shadow-lg ${
            pop.closing ? 'animate-pop-out' : 'animate-pop-in'
          }`}
        >
          <div className="grid grid-cols-6 gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  onChange(c)
                  setOpen(false)
                }}
                title={c}
                aria-label={c}
                className={`h-5 w-5 rounded-full border-2 ${
                  color.toLowerCase() === c.toLowerCase()
                    ? 'border-fg'
                    : 'border-transparent'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
              <input
                type="color"
                value={normalizeHex(color)}
                onChange={(e) => onChange(e.target.value)}
                className="h-5 w-5 cursor-pointer rounded border border-line bg-transparent p-0"
                aria-label="Custom colour"
              />
              Custom
            </label>
            <button
              type="button"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
              className="font-mono text-[10px] uppercase tracking-wider text-muted hover:text-fg"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** <input type="color"> only accepts #rrggbb. */
function normalizeHex(c: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#f5a623'
}
