import { useEffect, useRef, useState } from 'react'
import { Share2, Check, Copy, Globe, Lock } from 'lucide-react'
import type { Project } from '../types'

interface Props {
  project: Project
  onToggleShare: (shared: boolean) => void
}

/** Read-only link to this project's share viewer (same app, `?view=` route). */
function shareUrl(id: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?view=${id}`
}

/**
 * Sub-bar control that turns a project into a read-only shared link. Opening the
 * panel reveals a single switch — "Anyone with the link can view" — and, once on,
 * the copyable link. Toggling persists `shared` on the project (the parent saves
 * it), which flips the firestore.rules read gate.
 */
export default function SharePanel({ project, onToggleShare }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const shared = project.shared === true
  const url = shareUrl(project.id)

  // Close on outside-click or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — the field is selectable as a fallback */
    }
  }

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={shared ? 'Shared — manage link' : 'Share a read-only link'}
        className={`press inline-flex items-center gap-1 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
          shared
            ? 'border-accent/60 bg-accent/10 text-accent'
            : 'border-line text-muted hover:border-line-strong hover:text-fg'
        }`}
      >
        <Share2 size={12} />
        {shared ? 'Shared' : 'Share'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 animate-panel-in rounded border border-line bg-panel p-3 shadow-lg shadow-black/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                {shared ? (
                  <Globe size={13} className="text-accent" />
                ) : (
                  <Lock size={13} className="text-muted" />
                )}
                Anyone with the link
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">
                {shared
                  ? 'Can open this track read-only — no sign-in needed.'
                  : 'Turn on to create a read-only link you can send.'}
              </p>
            </div>
            {/* Switch */}
            <button
              role="switch"
              aria-checked={shared}
              onClick={() => onToggleShare(!shared)}
              title={shared ? 'Stop sharing' : 'Start sharing'}
              className={`press relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
                shared ? 'border-accent bg-accent/30' : 'border-line bg-inset'
              }`}
            >
              <span
                className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left] ${
                  shared ? 'left-[18px] bg-accent' : 'left-0.5 bg-muted'
                }`}
              />
            </button>
          </div>

          {shared && (
            <div className="mt-3 flex items-center gap-1.5">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Read-only share link"
                className="led min-w-0 flex-1 rounded border border-line bg-inset px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-accent"
              />
              <button
                onClick={copy}
                title="Copy link"
                className="press inline-flex shrink-0 items-center gap-1 rounded border border-line bg-raised px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg hover:border-accent hover:text-accent"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
