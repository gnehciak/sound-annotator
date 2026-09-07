import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { adoptGuestFromUrl, guestSessionFromUrl } from '../lib/guest'
import LandingPage from './LandingPage'
import HomeDot from './HomeDot'

/**
 * True when the URL is reaching for one specific thing that needs an account —
 * a private track (`?track=` with no guest key) or the admin console. Those
 * visitors want the sign-in card immediately; a landing page in front of it
 * would just be a wall between them and the thing they clicked.
 */
function isAccountDeepLink(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('track') != null || params.get('admin') != null
}

/** Why a sign-in attempt came back empty-handed. The callback route puts these
 *  in `?auth_error=` rather than stranding the visitor on an API error page. */
const SIGN_IN_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled. Nothing has changed.',
  state:
    'That sign-in link expired before it could finish. Please try again.',
  exchange:
    "Google couldn't complete the sign-in. Please try again in a moment.",
}

function signInErrorFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('auth_error')
  if (!code) return null
  return SIGN_IN_ERRORS[code] ?? 'Sign-in failed. Please try again.'
}

/**
 * Decides what to render based on auth state: a spinner while auth resolves,
 * the landing page (or the sign-in card, on a deep link) when signed out, and
 * the app itself once signed in.
 */
export default function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading, configured } = useAuth()
  // A `?track=…&key=…` link is a student returning to their own work: adopt it
  // before deciding anything, or we'd flash the sign-in screen at someone who
  // is already holding a valid credential.
  const [adopting, setAdopting] = useState(() => guestSessionFromUrl() != null)
  // Which signed-out face is showing. There is no router, so this is plain
  // state — the landing page is the default door, and "Sign in" opens the
  // card. A failed sign-in comes back here, so its error opens the card too.
  const [showSignIn, setShowSignIn] = useState(
    () => isAccountDeepLink() || signInErrorFromUrl() != null,
  )

  useEffect(() => {
    if (!adopting) return
    let cancelled = false
    void adoptGuestFromUrl().finally(() => {
      if (!cancelled) setAdopting(false)
    })
    return () => {
      cancelled = true
    }
  }, [adopting])

  if (loading || adopting) return <Splash label="Connecting…" />
  if (!configured) return <SetupNotice />
  if (!user)
    return showSignIn ? (
      <SignIn onBack={() => setShowSignIn(false)} />
    ) : (
      <LandingPage onSignIn={() => setShowSignIn(true)} />
    )
  return <>{children}</>
}

function Splash({ label }: { label: string }) {
  return (
    <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-3 bg-ink text-muted">
      <span className="animate-now-pulse text-2xl text-accentink">◉</span>
      <span className="font-mono text-xs uppercase tracking-[0.2em]">{label}</span>
    </div>
  )
}

/**
 * The sign-in card. One door: Google.
 *
 * This used to be Clerk's prebuilt component wearing our tokens through a
 * 200-line appearance map. It carries the same single credential flow now with
 * none of that, because Google is the only way in — there is no password to
 * set, no code to verify, no reset to request, so there is no multi-step
 * machine for a card to host.
 */
function SignIn({ onBack }: { onBack: () => void }) {
  const { signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error] = useState(signInErrorFromUrl)

  return (
    <div className="flex h-full animate-fade-in items-center justify-center overflow-y-auto bg-ink py-8 text-fg">
      <div className="w-full max-w-sm animate-panel-in">
        <div className="mb-6 flex items-center justify-center">
          <HomeDot size={10}>
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">
              Sound&nbsp;Annotator
            </span>
          </HomeDot>
        </div>

        <div className="glass px-7 py-8 text-center">
          <h1 className="text-[17px] font-semibold text-fg-strong">
            Sign in to Sound Annotator
          </h1>
          <p className="mx-auto mt-2 max-w-[17rem] text-[13px] leading-relaxed text-muted">
            Keep your tracks and notes synced across devices.
          </p>

          {error && (
            <p
              role="alert"
              className="mt-5 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-left text-[12.5px] leading-relaxed text-fg"
            >
              {error}
            </p>
          )}

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void signInWithGoogle()
            }}
            // Google's own button colours, not ours — see GoogleMark. The
            // shadow is the one addition: on the light theme's pale card a
            // white button on near-white glass reads as a flat patch, and the
            // lift is what makes it register as a control.
            className="press mt-6 flex h-11 w-full items-center justify-center gap-3 rounded-full border border-[#747775] bg-white text-[14px] font-medium text-[#1f1f1f] shadow-[0_1px_2px_rgb(0_0_0/0.12)] transition-[filter] hover:brightness-[0.97] disabled:opacity-60"
          >
            <GoogleMark />
            {busy ? 'Taking you to Google…' : 'Sign in with Google'}
          </button>

          <p className="mt-5 text-[11.5px] leading-relaxed text-muted">
            We only ever see your name, email address and profile picture.
          </p>
        </div>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={onBack}
            className="press inline-flex items-center gap-1.5 rounded px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:text-fg"
          >
            <ArrowLeft size={12} />
            Start without an account
          </button>
        </div>
      </div>
    </div>
  )
}

/** Google's four-colour mark. Reproduced exactly, at the size and clear space
 *  their branding guidelines ask for — this is the one element on the page
 *  that isn't ours to restyle. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

/** Rendered when the deploy has no Google credentials configured — the server
 *  says so via /api/auth/me, so this can never be a guess made from the
 *  client's own env. */
export function SetupNotice() {
  return (
    <div className="flex h-full items-center justify-center bg-ink text-fg">
      <div className="glass w-full max-w-md p-8">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">
            Sound&nbsp;Annotator
          </span>
        </div>
        <h1 className="text-lg font-semibold">Sign-in is not configured</h1>
        <p className="mt-2 text-sm text-muted">
          The API needs{' '}
          <code className="text-accentink">GOOGLE_CLIENT_ID</code>,{' '}
          <code className="text-accentink">GOOGLE_CLIENT_SECRET</code> and{' '}
          <code className="text-accentink">AUTH_SECRET</code>. Run{' '}
          <code className="text-accentink">vercel env pull</code>, then restart{' '}
          <code className="text-accentink">npm run dev:full</code>.
        </p>
      </div>
    </div>
  )
}
