import { useEffect, useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import {
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth'
import { auth, googleProvider } from '../lib/firebase'
import { copySharedProject } from '../lib/copyProject'
import type { Project } from '../types'

/**
 * "Make a copy" on the read-only share viewer: clones the shared project into
 * the visitor's own account (signing them in with Google first if needed),
 * then redirects into the full app, where the fresh copy opens. The viewer
 * renders outside the auth Gate, so this subscribes to auth state itself.
 */
export default function CopyProjectButton({ project }: { project: Project }) {
  const [user, setUser] = useState<User | null>(auth.currentUser)
  const [busy, setBusy] = useState(false)
  const [label, setLabel] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => onAuthStateChanged(auth, setUser), [])

  async function makeCopy() {
    if (busy) return
    setFailed(false)
    setBusy(true)
    try {
      let u = user
      if (!u) {
        setLabel('Signing in…')
        u = (await signInWithPopup(auth, googleProvider)).user
      }
      setLabel('Copying…')
      const newId = await copySharedProject(u.uid, project, setLabel)
      // Swap `?view=` for a `?track=` deep link: the signed-in app loads and
      // opens the fresh copy directly in the editor.
      setLabel('Opening…')
      window.location.href = `${window.location.pathname}?track=${newId}`
    } catch (err) {
      const code = (err as { code?: string }).code
      // Closing the sign-in popup is a cancel, not a failure.
      if (
        code !== 'auth/popup-closed-by-user' &&
        code !== 'auth/cancelled-popup-request'
      ) {
        console.error('Failed to copy project:', err)
        setFailed(true)
      }
      setBusy(false)
      setLabel('')
    }
  }

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
      className={`press inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors disabled:cursor-wait ${
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
