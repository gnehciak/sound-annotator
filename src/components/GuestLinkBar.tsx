import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { guestEditUrl, guestHandInUrl, loadGuestSession } from '../lib/guest'

/**
 * The guest's two links, inline in the masthead.
 *
 * A guest project has no account behind it, so these URLs are the entire
 * means of reaching the work — the private one is a credential, not a
 * bookmark. Two links, one first: the hand-in link is read-only (no key) so
 * a marker can't type into a student's project, and it leads because handing
 * in is the task. The private link's title carries the warning: lose it on a
 * school machine whose browser storage gets wiped nightly, and the work is
 * unreachable.
 */
export default function GuestLinks() {
  const session = loadGuestSession()
  const [copied, setCopied] = useState<'hand-in' | 'private' | null>(null)

  if (!session) return null

  const copy = async (which: 'hand-in' | 'private') => {
    const url = which === 'hand-in' ? guestHandInUrl(session) : guestEditUrl(session)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(which)
      window.setTimeout(() => setCopied(null), 1600)
    } catch {
      // Clipboard denied (insecure origin / permissions): prompt() at least
      // puts the URL somewhere the student can select it by hand.
      window.prompt('Copy this link:', url)
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => void copy('hand-in')}
        className="btn-signal btn-sm press"
        title="A read-only link to your work — this is what you hand in"
      >
        {copied === 'hand-in' ? <Check size={12} /> : <Copy size={12} />}
        {copied === 'hand-in' ? 'Copied' : 'Hand-in link'}
      </button>
      <button
        type="button"
        onClick={() => void copy('private')}
        className="btn-ghost btn-sm press"
        title="Your private edit link — the only way back to this work. There is no account behind it: keep the link, and don't hand it in."
      >
        {copied === 'private' ? <Check size={12} /> : <Copy size={12} />}
        {copied === 'private' ? 'Copied' : 'Private link'}
      </button>
    </div>
  )
}
