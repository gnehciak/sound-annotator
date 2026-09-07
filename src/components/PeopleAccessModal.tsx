import { useEffect, useRef, useState } from 'react'
import { Loader2, RotateCw, Trash2, UserPlus, X } from 'lucide-react'
import type { Project, ProjectShare } from '../types'

/**
 * "Invite collaborators" — the per-person half of sharing, in its own modal.
 *
 * It lives here rather than inside the share popover because the two are
 * different jobs at different rhythms: the link is opened weekly, glanced at
 * and copied, while the invite list is edited a couple of times a term and
 * wants room — an address to type, roles to compare, someone to remove without
 * mis-clicking a switch two rows up. Half a popover spent on an ACL made the
 * link, the thing people actually came for, the smaller half of the panel.
 *
 * The list itself is owned by the caller (ShareExportMenu), which already holds
 * it for the row's count; this is the surface, not the source of truth.
 */
export default function PeopleAccessModal({
  project,
  shares,
  failed,
  busy,
  error,
  onInvite,
  onSetRole,
  onRemove,
  onRetry,
  onClose,
}: {
  project: Project
  /** `null` is "still asking" — never "nobody"; see the caller. */
  shares: ProjectShare[] | null
  failed: boolean
  busy: boolean
  error: string | null
  onInvite: (email: string) => void
  onSetRole: (email: string, role: ProjectShare['role']) => void
  onRemove: (email: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const [invitee, setInvitee] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = () => {
    const email = invitee.trim()
    if (!email || busy) return
    onInvite(email)
    setInvitee('')
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/60 p-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Invite collaborators"
        className="glass-pop flex w-full max-w-md flex-col overflow-hidden rounded-2xl"
      >
        <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-line/70 bg-fg/[0.03] px-3.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            Invite collaborators
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
            className="btn-icon press"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[11.5px] leading-snug text-muted">
            Give one person access to{' '}
            <span className="text-fg">{project.title}</span> by the email they
            sign in with — independent of the share link, so it can stay
            read-only (or off) while a colleague edits.
          </p>

          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={invitee}
              onChange={(e) => setInvitee(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="name@school.edu"
              aria-label="Invite by email"
              className="field min-w-0 flex-1"
            />
            <button
              type="button"
              onClick={submit}
              disabled={busy || invitee.trim() === ''}
              aria-label="Invite this address as a viewer"
              title="Invite as a viewer — change the role in the list"
              className="btn-signal press shrink-0 disabled:opacity-40"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <UserPlus size={13} />
              )}
              Invite
            </button>
          </div>

          {error && (
            <p role="alert" className="text-[11.5px] leading-snug text-danger">
              {error}
            </p>
          )}

          {/* Three distinct answers, never one: still asking, couldn't ask, and
              the server's own "nobody" — in an access list those must not look
              alike. */}
          {shares == null && !failed && (
            <div className="space-y-1.5" aria-hidden>
              <div className="h-9 animate-pulse rounded bg-fg/[0.06]" />
              <div className="h-9 w-2/3 animate-pulse rounded bg-fg/[0.06]" />
            </div>
          )}

          {failed && (
            <div className="empty flex items-center justify-center gap-2 py-4">
              <span className="text-[11.5px] text-muted">
                Couldn’t load who has access.
              </span>
              <button type="button" onClick={onRetry} className="btn-ghost press">
                <RotateCw size={12} /> Retry
              </button>
            </div>
          )}

          {shares != null && shares.length === 0 && (
            <div className="empty py-5 text-[11.5px]">
              Nobody yet — only you can open this track.
            </div>
          )}

          {shares != null && shares.length > 0 && (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto">
              {shares.map((s) => (
                <li key={s.email} className="flex items-center gap-2 py-2">
                  <span
                    title={s.email}
                    className="min-w-0 flex-1 truncate text-[12.5px] text-fg"
                  >
                    {s.email}
                  </span>
                  {/* Two roles, so the chip *is* the control: clicking it is the
                      change, with no menu in between. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onSetRole(s.email, s.role === 'editor' ? 'viewer' : 'editor')
                    }
                    aria-label={`${s.email} can ${
                      s.role === 'editor' ? 'edit' : 'view'
                    } — click to change`}
                    title={
                      s.role === 'editor'
                        ? 'Can edit the notes — click to make it view-only'
                        : 'Opens it read-only — click to let them edit'
                    }
                    data-active={s.role === 'editor' || undefined}
                    // Role is data, so it takes the signal hue rather than a
                    // second grey: an editor is the exception worth spotting in
                    // a list of readers.
                    className={`chip chip-outline press shrink-0 ${
                      s.role === 'editor' ? 'chip-signal' : ''
                    }`}
                  >
                    {s.role === 'editor' ? 'Editor' : 'Viewer'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRemove(s.email)}
                    aria-label={`Remove ${s.email}`}
                    title="Remove"
                    className="btn-icon press shrink-0 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[11.5px] leading-snug text-muted">
            We don’t send the invitation — copy the share link and send it
            yourself.
          </p>
        </div>
      </div>
    </div>
  )
}
