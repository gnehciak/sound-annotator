import { useEffect, useRef, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { copySharedProject } from '../lib/copyProject'
import type { Project } from '../types'

/**
 * "Make a copy" on the read-only share viewer: clones the shared project into
 * the visitor's own account (signing them in with Google first if needed),
 * then redirects into the full app, where the fresh copy opens. Sign-in is a
 * full-page redirect through Clerk, so the button plants `?copy=1` in the
 * return URL and finishes the copy automatically once the visitor lands back
 * signed in.
 */
export default function CopyProjectButton({ project }: { project: Project }) {
  const { user, loading, signInWithGoogle } = useAuth()
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [failed, setFailed] = useState(false)
  const autoCopied = useRef(false)

  async function makeCopy() {
    if (busy) return
    setFailed(false)
    setBusy(true)
    try {
      if (!user) {
        setLabel('Signing in…')
        const url = new URL(window.location.href)
        url.searchParams.set('copy', '1')
        // Redirects away; Clerk brings the visitor back to `url` signed in,
        // where the ?copy=1 effect below picks the copy back up.
        await signInWithGoogleTo(url)
        return
      }
      setLabel('Copying…')
      const copy = await copySharedProject(user.uid, project, setLabel)
      // Swap `?view=` for a `?track=` deep link: the signed-in app loads and
      // opens the fresh copy directly in the editor.
      setLabel('Opening…')
      window.location.assign(`${window.location.pathname}?track=${copy.id}`)
    } catch (err) {
      console.error('Failed to copy project:', err)
      setFailed(true)
      setBusy(false)
      setLabel('')
    }
  }

  async function signInWithGoogleTo(returnTo: URL) {
    // useAuth's signInWithGoogle returns to the current URL; briefly swap the
    // location's search so the redirect lands on the ?copy=1 variant.
    window.history.replaceState(null, '', returnTo)
    await signInWithGoogle()
  }

  // Landed back from the sign-in redirect with ?copy=1: finish the job once.
  // Deferred a tick so the copy kicks off outside the effect body (no
  // cascading render) once auth has settled.
  useEffect(() => {
    if (loading || !user) return
    const t = window.setTimeout(() => {
      if (autoCopied.current) return
      const params = new URLSearchParams(window.location.search)
      if (params.get('copy') !== '1') return
      autoCopied.current = true
      params.delete('copy')
      const query = params.toString()
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`,
      )
      void makeCopy()
    }, 0)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user])

  return (
    <button
      type="button"
      onClick={makeCopy}
      disabled={busy}
      title={
        failed
          ? 'Copying failed — try again'
          : user
            ? 'Copy this track and its notes into your account'
            : 'Copy this track into your own account (you’ll be asked to sign in with Google)'
      }
      className={`press inline-flex shrink-0 items-center gap-1.5 rounded border px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:cursor-wait ${
        failed
          ? 'border-danger/60 text-danger hover:border-danger'
          : 'border-accent/60 bg-accent/10 text-accentink hover:border-accent'
      }`}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <Copy size={12} />}
      <span className={busy ? '' : 'hidden sm:inline'}>
        {busy ? label : failed ? 'Copy failed — retry' : 'Make a copy'}
      </span>
    </button>
  )
}
