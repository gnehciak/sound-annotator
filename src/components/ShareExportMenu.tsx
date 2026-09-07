import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Share2,
  Check,
  Copy,
  Globe,
  HelpCircle,
  LibraryBig,
  Lock,
  Pencil,
  UserPlus,
  FileDown,
  Braces,
  ClipboardList,
} from 'lucide-react'
import type { Project, ProjectShare } from '../types'
import { exportProjectPdf } from '../lib/exportPdf'
import { downloadProjectJson } from '../lib/projectJson'
import { isListeningTask, questionsOf } from '../lib/questions'
import { publicId } from '../lib/ids'
import { listShares, removeShare, setShare } from '../lib/shares'
import PeopleAccessModal from './PeopleAccessModal'
import { ApiError } from '../lib/api'

interface Props {
  project: Project
  /** Owner only — guests and link editors get the export section alone. */
  canShare: boolean
  /** PDF renders the notes list; structure boards have none to print. */
  canPdf: boolean
  /** Persist a sharing change; flags travel together so a role flip and
   *  the switch are each one write — including `published`, which is a
   *  property of the view-only link rather than a second gate, so turning the
   *  link off or handing it edit rights delists in the same patch. Unused
   *  (never called) when !canShare. */
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

/** Mirrors the server's deliberately loose check (api/_lib/shares.ts) so an
 *  obvious typo is caught here rather than round-tripping into a red error. */
function looksLikeEmail(raw: string): boolean {
  const e = raw.trim()
  return (
    e.length >= 3 && e.length <= 320 && /^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$/.test(e)
  )
}

/**
 * One switchable setting: label, switch, and — only while the panel is in
 * explain mode — one short line saying what it does.
 *
 * The explanations are one shared disclosure rather than a `?` per row. Four
 * identical dots is not progressive disclosure: nothing marks which you have
 * read, only one can be open at a time (so two can never be compared), and each
 * one shoves the rows below it down while you are aiming at them.
 */
function SwitchRow({
  icon,
  title,
  on,
  softDisabled,
  note,
  explain,
  explaining,
  onToggle,
  switchTitle,
  children,
}: {
  icon: React.ReactNode
  title: string
  on: boolean
  /** Refused rather than removed: `aria-disabled`, so the control keeps its
   *  place in the tab order and can still say why. A natively disabled button
   *  is unreachable by keyboard, and its reason — a `title` — reaches a mouse
   *  and nothing else. */
  softDisabled?: string
  /** A permanently visible qualifier, for a precondition too important to sit
   *  behind the explain toggle. */
  note?: string
  explain: string
  explaining: boolean
  onToggle: () => void
  switchTitle: string
  children?: React.ReactNode
}) {
  const hintId = useId()
  return (
    <div>
      <div className="flex items-start gap-1.5">
        <span className="mt-[2px] shrink-0 text-muted" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={`truncate text-xs font-semibold ${
              softDisabled ? 'text-muted' : 'text-fg'
            }`}
          >
            {title}
          </p>
          {note && (
            <p className="mt-0.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              {note}
            </p>
          )}
        </div>
        <button
          role="switch"
          aria-checked={on}
          aria-label={title}
          aria-disabled={softDisabled ? true : undefined}
          aria-describedby={softDisabled || explaining ? hintId : undefined}
          onClick={() => {
            if (!softDisabled) onToggle()
          }}
          title={softDisabled ?? switchTitle}
          className={`switch press mt-0.5 shrink-0 ${
            softDisabled ? 'opacity-40' : ''
          }`}
        />
      </div>
      {(softDisabled || explaining) && (
        <p id={hintId} className="mt-1 text-[11px] leading-snug text-muted">
          {softDisabled ?? explain}
        </p>
      )}
      {children}
    </div>
  )
}

/**
 * Section header — the settings menu's vocabulary, so the two popovers in the
 * same title bar read as one system: a hairline straight across the pane with
 * the silkscreen label tucked directly under it (see ThemeMenuContent). A label
 * with a rule trailing off to its right is a different language; dividing the
 * pane edge to edge is what makes the blocks read as blocks.
 */
function SectionHeader({
  children,
  first,
  action,
}: {
  children: React.ReactNode
  /** The first header needs no rule — the pane's own edge divides it. */
  first?: boolean
  action?: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 pb-1 pt-1.5 ${
        first ? '' : 'mt-1 border-t border-line'
      }`}
    >
      <p className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
        {children}
      </p>
      {action}
    </div>
  )
}

/**
 * The editor bar's outputs control: one icon button opening sharing (owners
 * only) and the PDF / JSON exports.
 *
 * Sharing is two independent halves, and the panel is shaped like that rather
 * than like a list of flags. The **link** says what anyone holding it may do —
 * open it, optionally edit it, optionally be findable on Browse. The **people**
 * list says what one named person may do on top of that. Neither has to be
 * weakened to express the other: a read-only link handed to a class plus an
 * editor invite sent to a colleague is the ordinary shape, not a conflict.
 *
 * There is one URL throughout, which is why the two link settings nest under it
 * rather than standing beside it: listing on Browse never minted a second
 * address — the gallery card opens this same `?view=` link.
 *
 * The one action here that reaches strangers — listing on Browse — asks before
 * it happens, and the invite list gets its own modal rather than half of this
 * popover: it is edited a couple of times a term, while the link is opened
 * weekly.
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
  const [explaining, setExplaining] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const urlRef = useRef<HTMLInputElement>(null)
  // A legacy row could be published without `shared` (they used to be
  // independent gates); the server has always served those to link holders, so
  // read them as shared here too rather than stranding their Browse switch
  // behind an off link toggle.
  const shared = canShare && (project.shared === true || project.published === true)
  const canEdit = shared && project.editableByLink === true
  const published = canShare && project.published === true
  const url = shareUrl(publicId(project))
  // Copy always carries the whole URL; the field shows it without the scheme,
  // the way an address bar does, so the id — the only part that differs
  // between tracks — is visible instead of truncated off the right edge.
  const shownUrl = url.replace(/^https?:\/\//, '')
  // Question notes make the view link a listening task (see lib/questions.ts).
  const questionCount = isListeningTask(project)
    ? questionsOf(project.annotations).length
    : 0

  /* ---- people with access ------------------------------------------------ */
  // `null` is "not asked yet", never "nobody": in an access-control panel those
  // two must not render the same, so loading and failure get their own states
  // and an empty list is only ever the server's own answer.
  const [shares, setShares] = useState<ProjectShare[] | null>(null)
  const [sharesFailed, setSharesFailed] = useState(false)
  const [peopleOpen, setPeopleOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Fetched when the panel opens, not on mount: most sessions never open it,
  // and the list is small enough that a refetch per open beats a cache that can
  // disagree with what another tab just changed.
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

  const invite = (raw: string) => {
    const email = raw.trim()
    if (!email || busy) return
    if (!looksLikeEmail(email)) {
      setShareError('That doesn’t look like an email address.')
      return
    }
    void runShare(() => setShare(project.id, email, 'viewer'))
  }

  const close = useCallback(() => {
    setOpen(false)
    setExplaining(false)
    setConfirmPublish(false)
    // Escape must not drop focus on the document body — the keyboard user came
    // from the trigger and that is where they are put back.
    triggerRef.current?.focus()
  }, [])

  // Close on outside-click or Escape, and keep Tab inside the panel while it is
  // open: it floats over the editor, so walking out of it with the keyboard
  // lands in a workspace the pane is covering.
  useEffect(() => {
    if (!open || peopleOpen) return
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
  }, [open, peopleOpen, close])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopyFailed(false)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // A blocked clipboard used to fail in total silence — the teacher pastes
      // whatever was already there into the class chat and finds out from the
      // room. Select the field and say so instead.
      setCopyFailed(true)
      urlRef.current?.focus()
      urlRef.current?.select()
    }
  }

  const invitedCount = shares?.length ?? 0

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
            ? shared
              ? published
                ? 'Shared by link and listed on Browse — manage sharing & exports'
                : 'Shared by link — manage sharing & exports'
              : 'Share this track by link or with people, or export it'
            : 'Export this track'
        }
        // The tint means "this track is shared", not "this menu is open", so
        // the header answers "is it out there?" without being opened at all.
        data-active={shared || undefined}
        className="btn-icon-lg press relative"
      >
        <Share2 size={15} />
        {published && (
          <span
            aria-hidden
            className="absolute right-[5px] top-[5px] h-[5px] w-[5px] rounded-full bg-accent"
          />
        )}
      </button>

      {peopleOpen &&
        canShare &&
        createPortal(
          <PeopleAccessModal
            project={project}
            shares={shares}
            failed={sharesFailed}
            busy={busy}
            error={shareError}
            onInvite={invite}
            onSetRole={(email, role) =>
              void runShare(() => setShare(project.id, email, role))
            }
            onRemove={(email) =>
              void runShare(() => removeShare(project.id, email))
            }
            onRetry={() => {
              setSharesFailed(false)
              setShares(null)
              setReloadTick((t) => t + 1)
            }}
            onClose={() => {
              setPeopleOpen(false)
              setShareError(null)
            }}
          />,
          document.body,
        )}

      {open && (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Sharing and export"
          className={`pop absolute right-0 top-full z-30 mt-1.5 animate-panel-in py-1 ${
            canShare ? 'w-[19rem]' : 'w-60'
          }`}
        >
          {canShare && (
            <>
              <div className="px-2.5 pb-2 pt-1">
                {/* One row, one switch. A section header, a restatement of it
                    and a status readout were three lines saying the same
                    thing — the switch position is the status, and when the
                    link is on its own settings are right there under it. */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-muted" aria-hidden>
                    {shared ? <Globe size={13} /> : <Lock size={13} />}
                  </span>
                  <p className="min-w-0 flex-1 truncate text-xs font-semibold text-fg">
                    Share link
                  </p>
                  {/* One disclosure for the whole panel: press it once and
                      every setting explains itself at the same time — the
                      comparison a row of separate `?` dots makes impossible. */}
                  <button
                    type="button"
                    onClick={() => setExplaining((v) => !v)}
                    aria-pressed={explaining}
                    aria-label="Explain these settings"
                    title={
                      explaining ? 'Hide the explanations' : 'What do these do?'
                    }
                    data-active={explaining || undefined}
                    className="btn-icon press shrink-0"
                  >
                    <HelpCircle size={13} />
                  </button>
                  <button
                    role="switch"
                    aria-checked={shared}
                    aria-label="Share link"
                    onClick={() => {
                      setConfirmPublish(false)
                      onChange(
                        shared
                          ? { shared: false, editableByLink: false, published: false }
                          : { shared: true, editableByLink: false },
                      )
                    }}
                    title={shared ? 'Stop sharing' : 'Start sharing'}
                    className="switch press shrink-0"
                  />
                </div>
                {explaining && (
                  <p className="mt-1 text-[11px] leading-snug text-muted">
                    One link, opened read-only with no sign-in — students don’t
                    need accounts. Turning it off kills the link and clears both
                    settings below.
                  </p>
                )}

                {shared && (
                  <>
                    <input
                      ref={urlRef}
                      readOnly
                      value={shownUrl}
                      onFocus={(e) => e.currentTarget.select()}
                      aria-label="Share link"
                      className="field led mt-2 w-full font-mono text-[11px]"
                    />
                    {/* Copy is the panel's job — the one filled key, at full
                        width, rather than a ghost sitting quieter than the field
                        beside it. */}
                    <button
                      onClick={copy}
                      title="Copy the link to the clipboard"
                      className="btn-primary press mt-1.5 h-[30px] w-full justify-center py-0 text-[12px]"
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? 'Copied' : 'Copy link'}
                    </button>
                    <p role="status" aria-live="polite" className="sr-only">
                      {copied ? 'Link copied to the clipboard' : ''}
                    </p>
                    {copyFailed && (
                      <p className="mt-1.5 text-[11px] leading-snug text-muted">
                        Your browser blocked the clipboard — the link is selected
                        above, press{' '}
                        {navigator.platform.includes('Mac') ? '⌘C' : 'Ctrl+C'}.
                      </p>
                    )}

                    {/* Both settings below describe that one link, so they nest
                        under it instead of standing beside it as peers — which is
                        what made this panel read like three separate sharing
                        systems. */}
                    <div className="mt-2.5 space-y-2.5 border-l border-line pl-2.5">
                      <SwitchRow
                        icon={<Pencil size={13} />}
                        title="Link can edit too"
                        note="Sign-in · one at a time"
                        on={canEdit}
                        explaining={explaining}
                        switchTitle={
                          canEdit ? 'Make the link read-only' : 'Let link holders edit'
                        }
                        onToggle={() => {
                          setConfirmPublish(false)
                          onChange({
                            shared: true,
                            editableByLink: !canEdit,
                            published: false,
                          })
                        }}
                        explain="Everyone holding the link can change the notes. To let one colleague edit while the class stays read-only, invite them below instead."
                      />
                      <SwitchRow
                        icon={<LibraryBig size={13} />}
                        title="Also list on Browse"
                        on={published}
                        softDisabled={
                          canEdit
                            ? 'Only a read-only link can be listed — a public page of tracks strangers can rewrite isn’t a promise worth making.'
                            : undefined
                        }
                        explaining={explaining}
                        switchTitle={published ? 'Remove from Browse' : 'List on Browse'}
                        onToggle={() => {
                          if (published) {
                            setConfirmPublish(false)
                            onChange({ shared: true, published: false })
                          } else {
                            setConfirmPublish(true)
                          }
                        }}
                        explain="Puts this track on the public Browse page so anyone can find it, not just the people you send the link to. Same link either way."
                      >
                        {confirmPublish && !published && !canEdit && (
                          <div className="well mt-1.5 p-2">
                            <p className="text-[11px] leading-snug text-fg">
                              Anyone on the internet will be able to find “
                              {project.title}” and open it.
                            </p>
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmPublish(false)
                                  onChange({ shared: true, published: true })
                                }}
                                className="btn-signal btn-sm press"
                              >
                                List it
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmPublish(false)}
                                className="btn-ghost btn-sm press"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                        {published && (
                          <a
                            href={`${window.location.pathname}?browse=1`}
                            className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink hover:underline"
                          >
                            See it on Browse →
                          </a>
                        )}
                      </SwitchRow>
                    </div>

                    {/* A listening task is what the link *becomes*, not a
                        setting — so it stays visible, in one line: it changes
                        what the person opening it is handed. */}
                    {questionCount > 0 && (
                      <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
                        <ClipboardList
                          size={12}
                          className="mt-[1px] shrink-0 text-accentink"
                        />
                        <span>
                          Opens as a listening task — {questionCount}{' '}
                          {questionCount === 1 ? 'question' : 'questions'}, answered
                          in the page and handed back as a PDF.
                        </span>
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* The invite list is a couple of edits a term, not a weekly
                  glance — it gets its own room (PeopleAccessModal) rather than
                  half of this popover, which left the link, the thing people
                  actually open this for, as the smaller half. */}
              <button
                type="button"
                onClick={() => setPeopleOpen(true)}
                className="pop-row press mt-1 border-t border-line pt-2"
              >
                <UserPlus size={13} className="shrink-0" />
                People with access
                <span className="ml-auto font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {shares == null ? '—' : invitedCount === 0 ? 'Only you' : invitedCount}
                </span>
              </button>
            </>
          )}

          {/* Export — the portable outputs, one row each. */}
          <div>
            <SectionHeader first={!canShare}>Export</SectionHeader>
            <div>
              {canPdf && (
                <button
                  type="button"
                  onClick={() => {
                    close()
                    exportProjectPdf(project)
                  }}
                  title="Export this track's notes to a PDF (opens in a new tab)"
                  className="pop-row press rounded"
                >
                  <FileDown size={13} className="shrink-0" />
                  PDF
                  <span className="ml-auto text-[10px] text-muted">notes list</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  close()
                  downloadProjectJson(project)
                }}
                title="Export this track (source + notes) as a JSON file you can re-import"
                className="pop-row press rounded"
              >
                <Braces size={13} className="shrink-0" />
                JSON
                <span className="ml-auto text-[10px] text-muted">portable file</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
