import { useEffect, useRef, useState } from 'react'
import { Share2, Check, Copy, Globe, Lock, Eye, Pencil } from 'lucide-react'
import type { Project } from '../types'

interface Props {
  project: Project
  /** Persist a sharing change; flags travel together so a role flip and
   *  the switch are each one write. `published` rides the same patch when
   *  the Publish switch flips. */
  onChange: (patch: {
    shared?: boolean
    editableByLink?: boolean
    published?: boolean
  }) => void
}

/** Link to this project's share viewer (same app, `?view=` route). */
function shareUrl(id: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?view=${id}`
}

/**
 * Sub-bar control for sharing a project by link, Google-Docs style. Opening
 * the panel reveals the "Anyone with the link" switch and, once on, a role —
 * **Can view** (read-only viewer, no sign-in) or **Can edit** (signed-in
 * visitors may edit notes/title, one session at a time via the edit lock) —
 * plus the copyable link. The parent persists the flags, which flip the
 * firestore.rules gates.
 */
export default function SharePanel({ project, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const shared = project.shared === true
  const canEdit = shared && project.editableByLink === true
  const published = project.published === true
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
        title={
          shared || published
            ? 'Sharing is on — manage link & publishing'
            : 'Share this track by link, or publish it'
        }
        className={`press inline-flex items-center gap-1.5 rounded border px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
          shared || published
            ? 'border-accent/70 bg-accent/10 text-accentink hover:bg-accent/20'
            : 'border-line text-muted hover:border-line-strong hover:text-fg'
        }`}
      >
        <Share2 size={12} />
        {shared ? 'Shared' : published ? 'Published' : 'Share'}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 animate-panel-in rounded border border-line bg-panel p-3.5 shadow-lg shadow-black/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                {shared ? (
                  <Globe size={13} className="text-accentink" />
                ) : (
                  <Lock size={13} className="text-muted" />
                )}
                Anyone with the link
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">
                {!shared
                  ? 'Turn on to create a link you can send.'
                  : canEdit
                    ? 'Can edit the notes after signing in with Google — one person at a time.'
                    : 'Can open this track read-only — no sign-in needed.'}
              </p>
            </div>
            {/* Switch */}
            <button
              role="switch"
              aria-checked={shared}
              onClick={() =>
                onChange({ shared: !shared, editableByLink: false })
              }
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
            <>
              {/* Link role — view-only or link-editing (Docs-style). */}
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                  Link role
                </span>
                <div
                  role="group"
                  aria-label="Link permission"
                  className="flex items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]"
                >
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ shared: true, editableByLink: false })
                    }
                    aria-pressed={!canEdit}
                    title="Anyone with the link can view"
                    className={`press flex h-[26px] items-center gap-1 rounded px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ${
                      canEdit ? 'text-muted hover:text-fg' : 'bg-raised text-fg'
                    }`}
                  >
                    <Eye size={11} /> Can view
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ shared: true, editableByLink: true })
                    }
                    aria-pressed={canEdit}
                    title="Anyone with the link can edit (sign-in required)"
                    className={`press flex h-[26px] items-center gap-1 rounded px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ${
                      canEdit
                        ? 'bg-raised text-accentink'
                        : 'text-muted hover:text-fg'
                    }`}
                  >
                    <Pencil size={11} /> Can edit
                  </button>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-1.5">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Share link"
                  className="led bevel-inset min-w-0 flex-1 rounded border border-line bg-inset px-[9px] py-[6px] font-mono text-[11px] text-fg outline-none focus:border-accent"
                />
                <button
                  onClick={copy}
                  title="Copy link"
                  className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line bg-raised px-2 py-[6px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fg transition-colors hover:border-accent hover:text-accentink"
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </>
          )}

          {/* Publish — the public Browse gallery. Independent of the link
              switch above: an unlisted link and a public listing are
              different promises, so each gets its own gate. */}
          <div className="mt-3.5 border-t border-line pt-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
                  <Globe
                    size={13}
                    className={published ? 'text-accentink' : 'text-muted'}
                  />
                  Publish to Browse
                </p>
                <p className="mt-0.5 text-[11px] leading-snug text-muted">
                  {published
                    ? 'Listed on the public Browse page — anyone can open it read-only or copy it.'
                    : 'List this track on the public Browse page for anyone to find.'}
                </p>
              </div>
              <button
                role="switch"
                aria-checked={published}
                onClick={() => onChange({ published: !published })}
                title={published ? 'Unpublish' : 'Publish'}
                className={`press relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors ${
                  published
                    ? 'border-accent bg-accent/30'
                    : 'border-line bg-inset'
                }`}
              >
                <span
                  className={`absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full transition-[left] ${
                    published ? 'left-[18px] bg-accent' : 'left-0.5 bg-muted'
                  }`}
                />
              </button>
            </div>
            {published && (
              <a
                href={`${window.location.pathname}?browse=1`}
                className="mt-2 inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink hover:underline"
              >
                View it on Browse →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
