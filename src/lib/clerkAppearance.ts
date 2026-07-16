// Clerk's prebuilt <SignIn> card, dressed in Listening Station tokens.
//
// Clerk computes color scales in JS (hover/active shades are derived from the
// values we pass), so it can't take `rgb(var(--accent))` — it needs concrete
// colors. That makes this a painter in the same sense as the canvas and
// wavesurfer: it reads tokens through cssRgb and re-reads them on every
// mode/palette flip, keyed by useThemeKey. Structure and chrome stay in
// Tailwind classes (`elements`), so the card inherits the app's bevels and
// radii rather than Clerk's.
import { useMemo } from 'react'
import { cssRgb, useThemeKey } from './theme'

/**
 * A token as `#rrggbb`. Clerk parses these strings in JS to derive its own
 * hover/active/alpha scales, and its parser rejects CSS's modern
 * space-separated `rgb(245 166 35)` — the form cssRgb emits for canvas. A
 * rejected color silently lands as transparent (an invisible Continue
 * button), so every color handed to Clerk goes through here.
 */
function hexToken(token: string): string {
  const [r, g, b] = cssRgb(token)
    .replace(/[^\d\s.]/g, '')
    .trim()
    .split(/\s+/)
    .map(Number)
  if ([r, g, b].some(Number.isNaN)) return '#000000'
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

export function useClerkAppearance() {
  const themeKey = useThemeKey()

  return useMemo(() => {
    const dark = themeKey.startsWith('dark')

    return {
      variables: {
        colorPrimary: hexToken('--accent'),
        colorPrimaryForeground: hexToken('--on-accent'),
        colorBackground: hexToken('--bg-panel'),
        colorForeground: hexToken('--text'),
        colorMutedForeground: hexToken('--text-muted'),
        colorInputBackground: hexToken('--bg-inset'),
        colorInputForeground: hexToken('--text'),
        colorBorder: hexToken('--border'),
        colorRing: hexToken('--accent-ink'),
        colorShadow: hexToken('--border-strong'),
        colorDanger: hexToken('--danger'),
        colorSuccess: hexToken('--meter'),
        colorWarning: hexToken('--peak'),
        // Clerk shades borders/hovers off this one: it must oppose the
        // surface, so it flips with the mode rather than following a token.
        colorNeutral: dark ? 'white' : 'black',
        fontFamily: '"IBM Plex Sans", system-ui, sans-serif',
        fontFamilyButtons: '"IBM Plex Sans", system-ui, sans-serif',
        // = Tailwind's `rounded` here (6px, "softly squared"), not Clerk's pill.
        borderRadius: '6px',
      },
      elements: {
        // Clerk's own drop shadow reads as a floating web form; the app's
        // panels are flat planes with a hairline, so we supply the edge.
        cardBox: 'shadow-none border border-line rounded',
        card: 'bg-panel shadow-none',
        headerTitle: 'text-fg-strong font-semibold',
        headerSubtitle: 'text-muted',
        socialButtonsBlockButton: 'bevel-raised press bg-raised border-line text-fg',
        dividerLine: 'bg-line',
        dividerText: 'text-muted font-mono text-[11px] uppercase tracking-[0.18em]',
        formFieldLabel: 'text-fg font-mono text-[11px] uppercase tracking-[0.18em]',
        formFieldInput: 'bevel-inset bg-inset border-line text-fg',
        // Fill + text come from colorPrimary/colorPrimaryForeground above;
        // these only add the app's bevel, press physics, and label voice.
        formButtonPrimary: 'press bevel-raised font-bold normal-case',
        footerActionLink: 'text-accentink hover:brightness-110',
        // The verification code boxes read as LED readouts, like the timecode.
        otpCodeFieldInput: 'bevel-inset bg-inset border-line font-mono text-fg',
        identityPreviewText: 'text-fg',
        identityPreviewEditButton: 'text-accentink',
      },
    }
  }, [themeKey])
}
