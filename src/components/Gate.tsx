import { useEffect, useState } from 'react'
import { SignIn as ClerkSignIn } from '@clerk/clerk-react'
import { useAuth } from '../lib/auth'
import { useClerkAppearance } from '../lib/clerkAppearance'
import { adoptGuestFromUrl, enterGuest, guestSessionFromUrl } from '../lib/guest'

/**
 * Decides what to render based on auth state: a spinner while auth resolves,
 * the sign-in screen when signed out, and the app itself once signed in.
 * (When the backend isn't configured at all, main.tsx renders <SetupNotice>
 * instead of mounting Clerk — so this component can assume a live provider.)
 */
export default function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  // A `?track=…&key=…` link is a student returning to their own work: adopt it
  // before deciding anything, or we'd flash the sign-in screen at someone who
  // is already holding a valid credential.
  const [adopting, setAdopting] = useState(() => guestSessionFromUrl() != null)

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
  if (!user) return <SignIn />
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
 * card's own header.
 */
function SignIn() {
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
        <GuestEntry />
      </div>
    </div>
  )
}

/**
 * The students' door. Deliberately below Clerk's card and quieter than it:
 * teachers (who own libraries) should sign in, and only students handing in a
 * one-off assignment should come through here.
 */
function GuestEntry() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const session = await enterGuest()
      // Land on the private, key-bearing URL so a reload (or a copied address
      // bar) still reaches the project. enterGuest has already stored the key.
      window.location.assign(`/?track=${session.projectId}&key=${session.key}`)
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('Too many')
          ? 'Too many projects started on this network right now. Try again in a little while.'
          : 'Could not start a guest project. Try again.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 text-center">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          or
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <button
        onClick={go}
        disabled={busy}
        className="press bevel-raised w-full rounded border border-line bg-raised py-2.5 text-sm font-semibold text-fg hover:brightness-110 disabled:opacity-60"
      >
        {busy ? 'Starting…' : 'Continue as guest'}
      </button>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
        No account. You get a private link to your work — keep it, or you'll
        lose access.
      </p>
      {error && <p className="mt-2 font-mono text-[11px] text-danger">{error}</p>}
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
