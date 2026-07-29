import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { SignIn as ClerkSignIn } from '@clerk/clerk-react'
import { useAuth } from '../lib/auth'
import { useClerkAppearance } from '../lib/clerkAppearance'
import { adoptGuestFromUrl, guestSessionFromUrl } from '../lib/guest'
import LandingPage from './LandingPage'

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

/**
 * Decides what to render based on auth state: a spinner while auth resolves,
 * the landing page (or the sign-in card, on a deep link) when signed out, and
 * the app itself once signed in.
 * (When the backend isn't configured at all, main.tsx renders <SetupNotice>
 * instead of mounting Clerk — so this component can assume a live provider.)
 */
export default function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  // A `?track=…&key=…` link is a student returning to their own work: adopt it
  // before deciding anything, or we'd flash the sign-in screen at someone who
  // is already holding a valid credential.
  const [adopting, setAdopting] = useState(() => guestSessionFromUrl() != null)
  // Which signed-out face is showing. There is no router, so this is plain
  // state — the landing page is the default door and "Sign in" opens the card.
  const [showSignIn, setShowSignIn] = useState(isAccountDeepLink)

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
 * Clerk's prebuilt card, wearing our tokens (see lib/clerkAppearance.ts). It
 * carries every credential flow — Google, email + password, the sign-up
 * verification code, and forgot-password — so none of them live here.
 *
 * `withSignUp` folds sign-up into this one component instead of linking out to
 * a separate /sign-up route, and `routing="hash"` keeps each step's state in
 * the URL fragment. Both matter because the app has no router: there is no
 * path for Clerk to navigate to.
 *
 * The masthead sits above the card rather than inside it — Clerk owns the
 * card's own header. The guest door used to sit below it; it's the landing
 * page's paste field now, so the way back there is the only thing under the
 * card.
 */
function SignIn({ onBack }: { onBack: () => void }) {
  const appearance = useClerkAppearance()
  // Clerk hard-navigates once sign-in completes; without this it would land on
  // "/" and drop a deep link (?track=…, ?copy=1) the visitor arrived on.
  const here = window.location.pathname + window.location.search

  return (
    <div className="flex h-full animate-fade-in items-center justify-center overflow-y-auto bg-ink py-8 text-fg">
      <div className="w-full max-w-sm animate-panel-in">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">
            Sound&nbsp;Annotator
          </span>
        </div>
        <ClerkSignIn
          withSignUp
          routing="hash"
          appearance={appearance}
          fallbackRedirectUrl={here}
          signUpFallbackRedirectUrl={here}
        />
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

/** Rendered by main.tsx when the Clerk publishable key isn't configured. */
export function SetupNotice() {
  return (
    <div className="flex h-full items-center justify-center bg-ink text-fg">
      <div className="w-full max-w-md rounded border border-line bg-panel p-8">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em]">
            Sound&nbsp;Annotator
          </span>
        </div>
        <h1 className="text-lg font-semibold">Auth not configured</h1>
        <p className="mt-2 text-sm text-muted">
          Set <code className="text-accentink">VITE_CLERK_PUBLISHABLE_KEY</code>{' '}
          in <code className="text-accentink">.env.local</code> (run{' '}
          <code className="text-accentink">vercel env pull</code> after
          installing the Clerk integration), then restart the dev server.
        </p>
      </div>
    </div>
  )
}
