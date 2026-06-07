import { useState } from 'react'
import { LogIn } from 'lucide-react'
import { firebaseReady } from '../lib/firebase'
import { useAuth } from '../lib/auth'

/**
 * Decides what to render based on auth state: a setup notice when Firebase
 * isn't configured, a spinner while auth resolves, the sign-in screen when
 * signed out, and the app itself once signed in.
 */
export default function Gate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (!firebaseReady) return <SetupNotice />
  if (loading) return <Splash label="Connecting…" />
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

function SignIn() {
  const { signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle()
    } catch (e) {
      // Popup closed/blocked, etc. — show a quiet hint rather than a crash.
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full animate-fade-in items-center justify-center bg-ink text-fg">
      <div className="w-full max-w-sm animate-panel-in border border-line bg-panel p-8">
        <div className="mb-6 flex items-center gap-2">
          <span className="text-accentink">◉</span>
          <span className="text-xs font-semibold uppercase tracking-[0.22em]">
            Sound&nbsp;Annotator
          </span>
        </div>
        <h1 className="text-lg font-semibold">The Listening Station</h1>
        <p className="mt-1 text-sm text-muted">
          Sign in to keep your tracks and notes synced across devices.
        </p>

        <button
          onClick={go}
          disabled={busy}
          className="press bevel-raised mt-6 inline-flex w-full items-center justify-center gap-2 bg-accent py-2.5 text-sm font-bold text-onaccent hover:brightness-110 disabled:opacity-60"
        >
          <LogIn size={16} />
          {busy ? 'Opening…' : 'Continue with Google'}
        </button>

        {error && (
          <p className="mt-3 font-mono text-[11px] text-danger">{error}</p>
        )}
      </div>
    </div>
  )
}

function SetupNotice() {
  return (
    <div className="flex h-full items-center justify-center bg-ink text-fg">
      <div className="w-full max-w-md border border-line bg-panel p-8">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-accentink">◉</span>
          <span className="text-xs font-semibold uppercase tracking-[0.22em]">
            Sound&nbsp;Annotator
          </span>
        </div>
        <h1 className="text-lg font-semibold">Firebase not configured</h1>
        <p className="mt-2 text-sm text-muted">
          Create a <code className="text-accentink">.env.local</code> from{' '}
          <code className="text-accentink">.env.example</code> and paste your
          Firebase web-app config values, then restart the dev server.
        </p>
      </div>
    </div>
  )
}
