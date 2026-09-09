import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Share2,
  Check,
  ClipboardList,
  Copy,
  Globe,
  Info,
  Link2,
  Loader2,
  Lock,
  Eye,
  Pencil,
  Plus,
  RotateCw,
  TriangleAlert,
  X,
  Braces,
} from 'lucide-react'
import type { Project, ProjectShare } from '../types'
import ExportPdfButton from './ExportPdfButton'
import ExportDocxButton from './ExportDocxButton'
import { downloadProjectJson } from '../lib/projectJson'
import { isListeningTask, questionsOf } from '../lib/questions'
import { publicId } from '../lib/ids'
import { routeHref } from '../lib/nav'
import { listShares, removeShare, setShare } from '../lib/shares'
import { ApiError } from '../lib/api'

interface Props {
  project: Project
  /** Owner only — guests and link editors get the export band alone. */
  canShare: boolean
  /** PDF renders the notes list; structure boards have none to print. */
  canPdf: boolean
  /** Persist a sharing change; flags travel together so one rung of the ladder
   *  is one write. Unused (never called) when !canShare. */
  onChange: (patch: {
    shared?: boolean
    editableByLink?: boolean
    published?: boolean
  }) => void
}

/** How far this track reaches. The three flags underneath are not independent —
 *  publishing implies a link, and privacy is the absence of one — so the panel
 *  drives them as one ordered choice, and the server enforces the same ordering
 *  (see api/projects/[id]/index.ts). */
type Reach = 'private' | 'link' | 'browse'

/** Link to this project's share viewer. Built through the router rather than
 *  hand-assembled, so the one place that knows the shape of a `?view=` route
 *  stays src/lib/nav.ts — and a deployment on a sub-path keeps its prefix. */
function shareUrl(id: string): string {
  return window.location.origin + routeHref({ page: 'share', id })
}

/** Mirrors the server's deliberately loose check (api/_lib/shares.ts) so an
 *  obvious typo is caught here rather than round-tripping into a red error. */
function looksLikeEmail(raw: string): boolean {
  const e = raw.trim()
  return (
    e.length >= 3 && e.length <= 320 && /^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$/.test(e)
  )
}

/** The app's silkscreen label, as the pane title bars wear it. */
function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
      {children}
    </span>
  )
}

/**
 * The editor bar's sharing control: one popover holding everything that answers
 * "who can open this track", plus the two exports.
 *
 * **Reach is one ladder, not three switches.** A track has exactly one url, so
 * sharing isn't a set of independent flags — it is a single quantity, how far
 * this track travels: Private → Link → Browse. Driving it as one ordered choice
 * makes the state readable at a glance (the ladder *is* the status) and turns
 * the product's rule into structure rather than a validation error: while the
 * link can be written to, Browse simply isn't a stop, with the reason sitting in
 * the same line that always explains the current one.
 *
 * Writing is a separate axis and stays a switch — it says what a link holder may
 * *do*, not how far the track goes — and per-person access is a third, because a
 * read-only link for the class plus one editor colleague is the normal shape and
 * neither has to be weakened to express the other.
 *
 * Everything lives on this one surface. Splitting "who can see it" across a
 * popover and a modal is exactly what leaves a teacher unsure what is true.
 */
export default function ShareExportMenu({
  project,
  canShare,
  canPdf,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  // Stepping up to Browse arms rather than fires: it is the one move here that
  // reaches strangers, and the only one that cannot be taken back.
  const [arming, setArming] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)

  // A legacy row could be published without `shared` (they used to be
  // independent gates); the server has always served those to link holders, so
  // read them as shared here too.
  const published = canShare && project.published === true
  const shared = canShare && (project.shared === true || published)
  const canEdit = shared && project.editableByLink === true
  const reach: Reach = published ? 'browse' : shared ? 'link' : 'private'

  const url = shareUrl(publicId(project))
  // Split for the readout: the host is context, the id is the part that differs
  // between tracks and the only part worth checking before handing one to a
  // class — so the id gets the LED line and the host ellipsises above it.
  // Everything the url is *apart from* the id, so the split can't be wrong
  // whatever shape the route takes: the id is always its tail.
  const host = url.replace(/^https?:\/\//, '').slice(0, -publicId(project).length)
  const trackId = publicId(project)
  // Question notes turn the view link into a worksheet (see lib/questions.ts) —
  // it changes what the person opening it is handed, so it belongs beside the
  // sentence describing the link rather than behind anything.
  const questionCount = isListeningTask(project)
    ? questionsOf(project.annotations).length
    : 0

  /* ---- people ------------------------------------------------------------ */
  // `null` is "not asked yet", never "nobody": in an access list those two must
  // not render the same.
  const [shares, setShares] = useState<ProjectShare[] | null>(null)
  const [sharesFailed, setSharesFailed] = useState(false)
  const [invitee, setInvitee] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectShare['role']>('viewer')
  const [busy, setBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!open || !canShare) return
    let cancelled = false
    listShares(project.id)
      .then((list) => {
        if (cancelled) return
        setShares(list)
        setSharesFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        setShares(null)
        setSharesFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, canShare, project.id, reloadTick])

  // Every write answers with the whole list, so local state is replaced rather
  // than patched — the panel never has to guess what the server now believes.
  const runShare = useCallback(async (op: () => Promise<ProjectShare[]>) => {
    setBusy(true)
    setShareError(null)
    try {
      setShares(await op())
      setSharesFailed(false)
    } catch (e) {
      setShareError(
        e instanceof ApiError && e.status === 400
          ? e.message
          : 'That didn’t save — try again.',
      )
    } finally {
      setBusy(false)
    }
  }, [])

  const invite = () => {
    const email = invitee.trim()
    if (!email || busy) return
    if (!looksLikeEmail(email)) {
      setShareError('That doesn’t look like an email address.')
      return
    }
    void runShare(async () => {
      const list = await setShare(project.id, email, inviteRole)
      setInvitee('')
      return list
    })
  }

  /* ---- reach ------------------------------------------------------------- */
  const setReach = (next: Reach) => {
    if (next === reach) return
    setArming(false)
    if (next === 'private') {
      onChange({ shared: false, editableByLink: false, published: false })
    } else if (next === 'link') {
      onChange({ shared: true, published: false })
    } else {
      setArming(true) // Browse asks first
    }
  }

  const close = useCallback(() => {
    setOpen(false)
    setArming(false)
    triggerRef.current?.focus()
  }, [])

  // Close on outside-click or Escape, and keep Tab inside the panel while it is
  // open: it floats over the editor, so walking out of it with the keyboard
  // lands in a workspace the pane is covering.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        return
      }
      if (e.key !== 'Tab' || !popRef.current) return
      const focusable = popRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, a[href]',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === triggerRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopyFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // A blocked clipboard used to fail in total silence — the teacher pastes
      // whatever was already there into the class chat and finds out from the
      // room. Select the url and name the keystroke instead.
      setCopyFailed(true)
      urlRef.current?.focus()
      urlRef.current?.select()
    }
  }

  // The trigger's *glyph* carries the reach, not just its colour: the panel is
  // shut almost always, and a wash alone dies on a projector and on a
  // colourblind viewer.
  const TriggerIcon = published ? Globe : shared ? Link2 : Share2

  const count = shares?.length ?? 0
  const stat = sharesFailed
    ? 'Link · people unknown'
    : `${
        published
          ? 'Browse'
          : shared
            ? canEdit
              ? 'Link · editable'
              : 'Link'
            : 'Private'
      }${count > 0 ? ` · ${count} ${count === 1 ? 'person' : 'people'}` : ''}`

  const explain =
    reach === 'private' ? (
      <>Only you and the people below can open this track. The link is dead.</>
    ) : canEdit ? (
      <>
        Anyone holding the link can{' '}
        <b className="font-semibold text-fg">change the notes</b> after signing in.
        Browse is closed while that is true — a public listing has to be read-only.
      </>
    ) : reach === 'browse' ? (
      <>
        Listed on the public Browse page. Strangers can find this track and open it{' '}
        <b className="font-semibold text-fg">read-only</b>, or take their own copy.
      </>
    ) : (
      <>
        Anyone holding the link opens this track{' '}
        <b className="font-semibold text-fg">read-only</b>. No account, no sign-in —
        safe to give a class.
      </>
    )

  const rungs: { key: Reach; label: string; Icon: typeof Lock; off?: string }[] = [
    { key: 'private', label: 'Private', Icon: Lock },
    { key: 'link', label: 'Link', Icon: Link2 },
    {
      key: 'browse',
      label: 'Browse',
      Icon: Globe,
      off: canEdit ? 'Turn link editing off to publish' : undefined,
    },
  ]

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Share and export"
        title={
          canShare
            ? published
              ? 'Listed on Browse — manage sharing & exports'
              : shared
                ? 'Shared by link — manage sharing & exports'
                : 'Private — share this track, or export it'
            : 'Export this track'
        }
        data-active={shared || undefined}
        className="btn-icon-lg press"
      >
        <TriggerIcon size={15} />
      </button>

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Sharing and export"
          className={`pop absolute right-0 top-full z-30 mt-1.5 animate-panel-in ${
            canShare ? 'w-[23rem]' : 'w-56'
          }`}
        >
          {canShare && (
            <>
              <div className="strip flex h-9 items-center justify-between gap-2.5 border-b border-line/70 px-3.5">
                <Label>Sharing</Label>
                <span
                  role="status"
                  className={`truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    shared ? 'text-accentink' : 'text-muted'
                  }`}
                >
                  {stat}
                </span>
              </div>

              {/* ---- reach ------------------------------------------------ */}
              <div className="p-3.5">
                <Label>Reach</Label>
                <div
                  role="radiogroup"
                  aria-label="Reach"
                  className="seg mt-2 flex w-full p-[3px]"
                >
                  {rungs.map(({ key, label, Icon, off }) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={reach === key}
                      aria-disabled={off ? true : undefined}
                      title={off ?? `Reach: ${label}`}
                      onClick={() => !off && setReach(key)}
                      className={`seg-item press h-8 flex-1 text-[10px] tracking-[0.12em] ${
                        off ? 'opacity-35' : ''
                      } ${
                        arming && key === 'browse'
                          ? 'border border-dashed border-accent/80 text-accentink'
                          : ''
                      }`}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>

                <p className="mt-2 flex gap-1.5 text-[12px] leading-snug text-muted">
                  <Info
                    size={13}
                    className={`mt-[3px] shrink-0 ${
                      canEdit ? 'text-accentink' : 'text-muted'
                    }`}
                  />
                  <span>{explain}</span>
                </p>

                {shared && questionCount > 0 && (
                  <p className="mt-1.5 flex gap-1.5 text-[12px] leading-snug text-muted">
                    <ClipboardList
                      size={13}
                      className="mt-[3px] shrink-0 text-accentink"
                    />
                    <span>
                      It opens as a listening task — {questionCount}{' '}
                      {questionCount === 1 ? 'question' : 'questions'}, answered in
                      the page and handed back as a PDF.
                    </span>
                  </p>
                )}

                {/* Arming Browse asks in place — no modal thrown over the state
                    the teacher was just reading. */}
                {arming && (
                  <div className="mt-2.5 rounded-lg border border-accent/45 bg-accent/[0.07] p-3">
                    <p className="flex items-start gap-1.5 text-[12.5px] font-semibold leading-snug text-fg">
                      <Globe size={13} className="mt-[3px] shrink-0 text-accentink" />
                      <span>List “{project.title}” publicly?</span>
                    </p>
                    <p className="ml-[21px] mt-1.5 text-[12px] leading-snug text-muted">
                      It appears on the Browse page under your name. Strangers can
                      open it, play it and copy it. You can unlist it later — you
                      can’t un-publish what someone already read.
                    </p>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setArming(false)}
                        className="btn-ghost btn-sm press"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setArming(false)
                          onChange({
                            shared: true,
                            editableByLink: false,
                            published: true,
                          })
                        }}
                        className="btn-signal btn-sm press"
                      >
                        List in Browse
                      </button>
                    </div>
                  </div>
                )}

                {/* The url doesn't vanish when the link is off, it goes dark —
                    the fear on switching off is that it burns the address
                    already written on the board. It doesn't. */}
                <div
                  className={`mt-3 flex items-center gap-2.5 rounded-lg border bg-inset py-2 pl-3 pr-2 ${
                    copyFailed ? 'border-danger/60' : 'border-line'
                  } ${shared ? '' : 'opacity-40'}`}
                  style={{ boxShadow: 'var(--bevel-inset)' }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[10.5px] text-muted">
                      {host}
                    </span>
                    <input
                      ref={urlRef}
                      readOnly
                      value={trackId}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label={`Share link, ${url}`}
                      title={url}
                      className="led mt-[3px] block w-full border-0 bg-transparent p-0 font-mono text-[15px] font-medium outline-none"
                    />
                  </span>
                  <button
                    onClick={copy}
                    disabled={!shared}
                    aria-label="Copy link"
                    title="Copy the link to the clipboard"
                    className="btn-primary press shrink-0 disabled:opacity-40"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p role="status" aria-live="polite" className="sr-only">
                  {copied ? 'Link copied to the clipboard' : ''}
                </p>
                {!shared && (
                  <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-snug text-muted">
                    <Check size={12} className="mt-[2px] shrink-0" />
                    The same url comes back when you switch the link on again.
                  </p>
                )}
                {copyFailed && (
                  <p className="mt-1.5 flex gap-1.5 text-[11.5px] leading-snug text-danger">
                    <TriangleAlert size={12} className="mt-[2px] shrink-0" />
                    Your browser blocked the clipboard. The url is selected — press{' '}
                    {navigator.platform.includes('Mac') ? '⌘C' : 'Ctrl+C'}.
                  </p>
                )}

                {/* Writing is a different axis from reach, so it stays a switch.
                    Refused rather than removed while listed: `aria-disabled`
                    keeps it in the tab order and lets it say why. */}
                <div className="mt-3 flex items-start gap-2.5 border-t border-line/70 pt-3">
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[12.5px] leading-snug ${
                        canEdit ? 'font-semibold text-fg' : 'text-fg'
                      }`}
                    >
                      Link holders may edit the notes
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                      {published
                        ? 'Unlist from Browse to allow this'
                        : 'Sign-in required · one at a time'}
                    </span>
                  </span>
                  <button
                    role="switch"
                    aria-checked={canEdit}
                    aria-label="Link holders may edit the notes"
                    aria-disabled={!shared || published ? true : undefined}
                    onClick={() => {
                      if (!shared || published) return
                      setArming(false)
                      onChange({
                        shared: true,
                        editableByLink: !canEdit,
                        published: false,
                      })
                    }}
                    title={
                      published
                        ? 'Unlist from Browse to allow editing'
                        : !shared
                          ? 'Turn the link on first'
                          : canEdit
                            ? 'Make the link read-only'
                            : 'Let link holders edit'
                    }
                    className={`switch press mt-0.5 shrink-0 ${
                      !shared || published ? 'opacity-40' : ''
                    }`}
                  />
                </div>
              </div>

              {/* ---- people ----------------------------------------------- */}
              <div className="border-t border-line/70 p-3.5">
                <div className="flex items-center gap-2">
                  <Label>People</Label>
                  {count > 0 && (
                    <span className="font-mono text-[10px] font-semibold tabular-nums tracking-[0.14em] text-fg">
                      {count}
                    </span>
                  )}
                </div>

                {shares == null && !sharesFailed && (
                  <div className="mt-2 space-y-1" aria-hidden>
                    <div className="h-7 animate-pulse rounded bg-fg/[0.06]" />
                    <div className="h-7 w-2/3 animate-pulse rounded bg-fg/[0.06]" />
                  </div>
                )}

                {sharesFailed && (
                  <div className="well mt-2 p-3.5">
                    <p className="flex items-start gap-1.5 text-[12.5px] text-fg">
                      <TriangleAlert
                        size={13}
                        className="mt-[3px] shrink-0 text-danger"
                      />
                      Couldn’t load the people on this track.
                    </p>
                    <p className="ml-[21px] mt-1 text-[11.5px] leading-snug text-muted">
                      Nobody has been added or removed, and the link settings above
                      are unaffected.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSharesFailed(false)
                        setReloadTick((t) => t + 1)
                      }}
                      className="btn-ghost btn-sm press ml-[21px] mt-2.5"
                    >
                      <RotateCw size={12} /> Try again
                    </button>
                  </div>
                )}

                {shares != null && shares.length > 0 && (
                  <ul className="mt-1.5 max-h-[9rem] overflow-y-auto">
                    {shares.map((s) => (
                      <li
                        key={s.email}
                        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-raised [&+&]:border-t [&+&]:border-line/55"
                      >
                        <span
                          title={s.email}
                          className="min-w-0 flex-1 truncate text-[12.5px] text-fg"
                        >
                          {s.email}
                        </span>
                        {/* Two roles, so the chip *is* the control: clicking it
                            is the change, with no menu in between. */}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runShare(() =>
                              setShare(
                                project.id,
                                s.email,
                                s.role === 'editor' ? 'viewer' : 'editor',
                              ),
                            )
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
                          className={`chip chip-outline press shrink-0 ${
                            s.role === 'editor' ? 'chip-signal' : 'chip-neutral'
                          }`}
                        >
                          {s.role === 'editor' ? (
                            <Pencil size={11} />
                          ) : (
                            <Eye size={11} />
                          )}
                          {s.role === 'editor' ? 'Editor' : 'Viewer'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void runShare(() => removeShare(project.id, s.email))
                          }
                          aria-label={`Remove ${s.email}`}
                          title="Remove"
                          className="btn-icon press shrink-0 opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <X size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* The composer is the list's next line: address, role, add. */}
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-line/70 pt-2.5">
                  <input
                    value={invitee}
                    onChange={(e) => {
                      setInvitee(e.target.value)
                      if (shareError) setShareError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        invite()
                      }
                    }}
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Add by email"
                    aria-label="Add by email"
                    className="field h-[30px] min-w-0 flex-1 py-0 text-[12px]"
                  />
                  <div role="radiogroup" aria-label="Role" className="seg h-[30px]">
                    {(['viewer', 'editor'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={inviteRole === r}
                        aria-label={
                          r === 'viewer' ? 'Invite as viewer' : 'Invite as editor'
                        }
                        title={r === 'viewer' ? 'Viewer' : 'Editor'}
                        onClick={() => setInviteRole(r)}
                        className="seg-item press h-[24px] px-2"
                      >
                        {r === 'viewer' ? <Eye size={12} /> : <Pencil size={12} />}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={invite}
                    disabled={busy || invitee.trim() === ''}
                    aria-label="Add this person"
                    title={`Add as ${inviteRole}`}
                    className="btn-ghost btn-sm press h-[30px] shrink-0 hover:border-accent hover:text-accentink disabled:opacity-40"
                  >
                    {busy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Plus size={12} />
                    )}
                    Add
                  </button>
                </div>
                {shareError && (
                  <p
                    role="alert"
                    className="mt-1.5 text-[11.5px] leading-snug text-danger"
                  >
                    {shareError}
                  </p>
                )}
                <p className="mt-2 flex gap-1.5 text-[11.5px] leading-snug text-muted">
                  <Info size={12} className="mt-[2px] shrink-0" />
                  No invitation is emailed. Send them the link yourself.
                </p>
              </div>
            </>
          )}

          {/* ---- export --------------------------------------------------- */}
          <div
            className={`strip flex items-center gap-2 px-3.5 py-2.5 ${
              canShare ? 'border-t border-line/70' : ''
            }`}
          >
            <Label>Export</Label>
            <span className="flex-1" />
            {/* These two stay put while they work — the menu is not closed
                under them, because the bar they carry is the only progress the
                Word export has, and the PDF's own tab is behind this one. */}
            {canPdf && <ExportPdfButton project={project} small />}
            {canPdf && <ExportDocxButton project={project} small />}
            <button
              type="button"
              onClick={() => {
                close()
                downloadProjectJson(project)
              }}
              title="Export this track (source + notes) as a JSON file you can re-import"
              className="btn-ghost btn-sm press"
            >
              <Braces size={12} /> JSON
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
