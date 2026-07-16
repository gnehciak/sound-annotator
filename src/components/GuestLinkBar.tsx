import { useState } from 'react'
import { Check, Copy, Link2, TriangleAlert } from 'lucide-react'
import { guestEditUrl, guestHandInUrl, loadGuestSession } from '../lib/guest'

/**
 * The guest's two links, and the only warning they get.
 *
 * A guest project has no account behind it, so these URLs are the entire
 * means of reaching the work — the private one is a credential, not a
 * bookmark. That's a real footgun, so the bar states it plainly rather than
 * hiding it behind an info icon: lose the private link on a school machine
 * whose browser storage gets wiped nightly, and the work is unreachable.
 *
 * Two links, one loud: the hand-in link is read-only (no key) so a marker
 * can't type into a student's project, and it's the one presented first
 * because handing in is the task.
 */
export default function GuestLinkBar() {
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
    <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2">
      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        <Link2 size={12} />
        Guest
      </span>

      <button
        onClick={() => void copy('hand-in')}
        className="press bevel-raised inline-flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 text-[11px] font-bold text-onaccent hover:brightness-110"
        title="A read-only link to your work — this is what you hand in"
      >
        {copied === 'hand-in' ? <Check size={12} /> : <Copy size={12} />}
        {copied === 'hand-in' ? 'Copied' : 'Copy hand-in link'}
      </button>

      <button
        onClick={() => void copy('private')}
        className="press inline-flex items-center gap-1.5 rounded border border-line bg-raised px-2.5 py-1 text-[11px] font-semibold text-fg hover:brightness-110"
        title="Your private link — it lets you edit. Keep it; don't hand it in."
      >
        {copied === 'private' ? <Check size={12} /> : <Copy size={12} />}
        {copied === 'private' ? 'Copied' : 'Copy private (edit) link'}
      </button>

      <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-muted">
        <TriangleAlert size={12} className="text-peak" />
        No account — keep your private link or you lose this work
      </span>
    </div>
  )
}
