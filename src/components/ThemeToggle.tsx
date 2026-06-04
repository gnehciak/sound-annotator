import { Monitor, Sun, Moon } from 'lucide-react'
import { nextTheme, type ResolvedTheme, type ThemePref } from '../lib/theme'

const ICON = { system: Monitor, light: Sun, dark: Moon } as const
const NAME = { system: 'System', light: 'Light', dark: 'Dark' } as const

/**
 * Header theme control: a ghost icon button that cycles System → Light → Dark.
 * The icon shows the chosen mode (Monitor when following the OS), so its meaning
 * is the preference, not just the resulting appearance. Matches the adjacent
 * icon buttons (Keyboard, Sign out) exactly.
 */
export default function ThemeToggle({
  pref,
  resolved,
  onChange,
}: {
  pref: ThemePref
  resolved: ResolvedTheme
  onChange: (pref: ThemePref) => void
}) {
  const Icon = ICON[pref]
  const label =
    pref === 'system' ? `System (currently ${NAME[resolved]})` : NAME[pref]
  return (
    <button
      type="button"
      onClick={() => onChange(nextTheme(pref))}
      title={`Theme: ${label} — click to switch`}
      aria-label={`Theme: ${label}. Click to switch theme.`}
      className="press rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
    >
      <Icon size={16} />
    </button>
  )
}
