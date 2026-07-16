import { useRef, useState } from 'react'
import { Monitor, Sun, Moon, Check } from 'lucide-react'
import Popover from './Popover'
import {
  PALETTES,
  type Palette,
  type ResolvedTheme,
  type ThemePref,
} from '../lib/theme'

const MODES = [
  { value: 'system', name: 'System', Icon: Monitor },
  { value: 'light', name: 'Light', Icon: Sun },
  { value: 'dark', name: 'Dark', Icon: Moon },
] as const

const MODE_ICON = { system: Monitor, light: Sun, dark: Moon } as const
const MODE_NAME = { system: 'System', light: 'Light', dark: 'Dark' } as const

// Each palette's signal color per resolved mode — hardcoded swatches, because
// only the ACTIVE palette's tokens exist on :root (the others can't be
// previewed through CSS variables). Keep in sync with src/index.css.
const SWATCH: Record<Palette, Record<ResolvedTheme, string>> = {
  tangerine: { dark: '#ff6a3d', light: '#e04e1a' },
  bubblegum: { dark: '#ff4fd1', light: '#d61fae' },
  limeade: { dark: '#c0f03c', light: '#16a34a' },
  crayon: { dark: '#4f8bff', light: '#335df0' },
}
const PALETTE_NAME: Record<Palette, string> = {
  tangerine: 'Tangerine',
  bubblegum: 'Bubblegum',
  limeade: 'Limeade',
  crayon: 'Crayon',
}

/**
 * Header theme control: a ghost icon button opening a small dropdown with the
 * two theme axes — mode (System / Light / Dark) and signal palette. The icon
 * shows the chosen mode (Monitor when following the OS), so its meaning is the
 * preference, not just the resulting appearance.
 */
export default function ThemeToggle({
  pref,
  resolved,
  palette,
  onChange,
  onPaletteChange,
}: {
  pref: ThemePref
  resolved: ResolvedTheme
  palette: Palette
  onChange: (pref: ThemePref) => void
  onPaletteChange: (palette: Palette) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const Icon = MODE_ICON[pref]
  const label =
    pref === 'system'
      ? `System (currently ${MODE_NAME[resolved]})`
      : MODE_NAME[pref]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Theme: ${label} · ${PALETTE_NAME[palette]}`}
        aria-label={`Theme: ${label}, palette ${PALETTE_NAME[palette]}. Open theme menu.`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="press grid h-8 w-8 place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <Icon size={16} />
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={184}
        className="rounded border border-line bg-panel py-1 shadow-lg"
      >
        <div className="px-2.5 pb-1 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
          Mode
        </div>
        <div role="radiogroup" aria-label="Theme mode" className="flex gap-1 px-2.5 pb-2">
          {MODES.map(({ value, name, Icon: MIcon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={pref === value}
              title={name}
              onClick={() => onChange(value)}
              className={`flex flex-1 items-center justify-center rounded border py-2 ${
                pref === value
                  ? 'border-line-strong bg-raised text-fg'
                  : 'border-line text-muted hover:bg-raised hover:text-fg'
              }`}
            >
              <MIcon size={13} />
            </button>
          ))}
        </div>

        <div className="border-t border-line px-2.5 pb-1 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
          Palette
        </div>
        <div role="radiogroup" aria-label="Signal palette">
          {PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={palette === p}
              onClick={() => {
                onPaletteChange(p)
                setOpen(false)
              }}
              className={`flex w-full items-center gap-2 px-2.5 py-2 text-left text-[12px] hover:bg-raised ${
                palette === p ? 'text-fg' : 'text-muted'
              }`}
            >
              <span
                aria-hidden
                // Arbitrary micro radius: rounded-sm (5px) on a 10px box is a
                // circle, not a softly-squared swatch (cf. the overview diamond).
                className="h-2.5 w-2.5 rounded-[3px] border border-line"
                style={{ background: SWATCH[p][resolved] }}
              />
              <span className="flex-1">{PALETTE_NAME[p]}</span>
              <Check
                size={12}
                className={palette === p ? 'text-accentink' : 'opacity-0'}
              />
            </button>
          ))}
        </div>
      </Popover>
    </>
  )
}
