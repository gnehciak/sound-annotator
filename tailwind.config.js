/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Semantic colors driven by CSS variables (see src/index.css :root).
      // Retune the whole app from one place. <alpha-value> lets `/opacity` work.
      colors: {
        ink: 'rgb(var(--bg-ink) / <alpha-value>)',
        panel: 'rgb(var(--bg-panel) / <alpha-value>)',
        raised: 'rgb(var(--bg-raised) / <alpha-value>)',
        inset: 'rgb(var(--bg-inset) / <alpha-value>)',
        note: 'rgb(var(--surface-note) / <alpha-value>)',
        line: 'rgb(var(--border) / <alpha-value>)',
        'line-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        fg: 'rgb(var(--text) / <alpha-value>)',
        'fg-strong': 'rgb(var(--text-strong) / <alpha-value>)',
        muted: 'rgb(var(--text-muted) / <alpha-value>)',
        // Two ambers: `accent` is the bright signal for FILLS/graphics;
        // `accentink` is the AA-safe amber for TEXT/icons/LED. Identical in
        // dark, divergent in light (bright amber fails AA as text on a pale
        // surface). Use `text-accentink` for amber text, `bg-accent` for fills.
        accent: 'rgb(var(--accent) / <alpha-value>)',
        accentink: 'rgb(var(--accent-ink) / <alpha-value>)',
        meter: 'rgb(var(--meter) / <alpha-value>)',
        peak: 'rgb(var(--peak) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        // Text that sits on an amber/hue fill — dark in both themes.
        onbright: 'rgb(var(--on-bright) / <alpha-value>)',
        onaccent: 'rgb(var(--on-accent) / <alpha-value>)',
        // Selected/active note row — = raised in dark, a warm highlight on the
        // white note page in light (where raised would vanish into the page).
        rowsel: 'rgb(var(--row-sel) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      // Motion system — "instrument motion": fast, decelerating, no bounce.
      // One expo-ish ease-out (matches the note-list FLIP) is the house curve.
      // prefers-reduced-motion is enforced globally in index.css.
      transitionTimingFunction: {
        instr: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'pop-in': {
          from: { opacity: '0', transform: 'translateY(-4px) scale(0.97)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pop-out': {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'translateY(-4px) scale(0.97)' },
        },
        'panel-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.985)' },
          to: { opacity: '1', transform: 'none' },
        },
        'panel-out': {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'translateY(6px) scale(0.99)' },
        },
        // Notes enter with fade + slide only (no height/scale) so the list's
        // FLIP reorder math isn't disturbed.
        'note-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        // The amber "now" dot breathes like an LED. Ends at full so it rests
        // bright when reduced-motion clamps it to one frame.
        'now-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
        // The docked inspector slides open by growing its column width, so the
        // notes list eases aside instead of the panel jumping in.
        'dock-in': { from: { width: '0' }, to: { width: '22rem' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out both',
        'fade-out': 'fade-out 140ms ease-in both',
        'pop-in': 'pop-in 130ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'pop-out': 'pop-out 110ms ease-in both',
        'panel-in': 'panel-in 200ms cubic-bezier(0.22, 1, 0.36, 1) both',
        'panel-out': 'panel-out 130ms ease-in both',
        // `backwards` (not `both`): no forwards-fill, so it never pins the
        // note's opacity over the resting `opacity-50` dim state.
        'note-in': 'note-in 200ms cubic-bezier(0.22, 1, 0.36, 1) backwards',
        'now-pulse': 'now-pulse 1.7s ease-in-out infinite',
        'dock-in': 'dock-in 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
      },
      // Squared-off: pro tools don't use the soft shadcn radii. Even `rounded-lg`
      // resolves to ~2px so nothing reads as a floating card.
      borderRadius: {
        none: '0px',
        sm: '1px',
        DEFAULT: '2px',
        md: '2px',
        lg: '2px',
        xl: '3px',
        '2xl': '4px',
        full: '9999px',
      },
    },
  },
  plugins: [],
}
