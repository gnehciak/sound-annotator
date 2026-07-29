// The front door: what a signed-out visitor sees at the root.
//
// It replaces a bare sign-in card, because the two people who arrive here
// without an account are a student handed a YouTube link and a teacher sizing
// the tool up — and neither of them wants a password prompt first. So the page
// leads with the one input that starts the work (paste a link → a guest track
// opens on that video) and follows it with the published gallery, which is the
// only proof of what the tool actually does.
//
// Signing in is still one click away in the masthead; a deep link that needs an
// account (?track=, ?admin=) skips this page entirely (see Gate).
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Blocks,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Play,
  TriangleAlert,
  X,
} from 'lucide-react'
import { fetchVideoTitle, parseVideoId } from '../lib/youtube'
import {
  forgetGuestTrack,
  guestHistory,
  guestTrackUrl,
  startGuestTrack,
  type GuestTrackRef,
} from '../lib/guest'
import { useResolvedTheme, useTheme } from '../lib/theme'
import ThemeToggle from './ThemeToggle'
import HomeDot from './HomeDot'
import Popover from './Popover'
import BrowseGallery from './BrowseGallery'
import { WaveArt } from './trackArt'

/** What the panel's readout is saying — the instrument reading its input. */
type Status = 'idle' | 'ready' | 'working' | 'error'

/** Scroll target for the hero's link down to the gallery. */
const PUBLISHED_ID = 'published-tracks'

/**
 * The two workspaces a track can open into — the same pair the signed-in
 * "New track" menu offers, named for what a visitor gets rather than for the
 * shape of the data. 'notes' is the app's classic annotated track (no
 * `settings.kind`); 'sections' is the song-structure board.
 */
type TrackKind = 'notes' | 'sections'

const KINDS: {
  value: TrackKind
  label: string
  detail: string
  /** The verb the primary key promises for this workspace. */
  action: string
  Icon: typeof Pencil
}[] = [
  {
    value: 'notes',
    label: 'Listening notes',
    detail:
      'Pin timestamped rich-text notes to moments. Click one and the player seeks there.',
    action: 'Start annotating',
    Icon: Pencil,
  },
  {
    value: 'sections',
    label: 'Song sections',
    detail:
      'Map the song’s shape on a timeline — intro, verse, chorus — and play any section back.',
    action: 'Start mapping',
    Icon: Blocks,
  },
]

export default function LandingPage({ onSignIn }: { onSignIn: () => void }) {
  const { pref, setPref, resolved, palette, setPalette } = useTheme()

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-ink text-fg">
      {/* The app's own masthead, unchanged — the first thing a visitor sees is
          the thing they'll be looking at all lesson. */}
      <header className="sticky top-0 z-10 flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <HomeDot>
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-fg">
            Sound&nbsp;Annotator
          </span>
        </HomeDot>
        <span className="flex-1" />
        <ThemeToggle
          pref={pref}
          resolved={resolved}
          palette={palette}
          onChange={setPref}
          onPaletteChange={setPalette}
        />
        <button
          type="button"
          onClick={onSignIn}
          className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
        >
          Sign in
        </button>
      </header>

      <main className="flex-1">
        <Hero />
        <PublishedSection />
      </main>

      <footer className="border-t border-line px-4 py-6 sm:px-6">
        <p className="mx-auto max-w-[1180px] font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          Sound Annotator — time-anchored music annotation
        </p>
      </footer>
    </div>
  )
}

/* ---- hero ----------------------------------------------------------------- */

/**
 * The paste field, staged as a source panel: title bar with a live readout,
 * an inset input, and the primary key. Deliberately the largest object on the
 * page — the headline is the caption, the input is the hero.
 */
function Hero() {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'link' | 'blank' | null>(null)
  const [history, setHistory] = useState<GuestTrackRef[]>(guestHistory)
  // Which of the app's two workspaces the link opens into. Same choice the
  // signed-in "New track" menu offers. Defaults to the section board: it's the
  // faster thing to have something to show for, and the notes workspace is one
  // pick away.
  const [kind, setKind] = useState<TrackKind>('sections')
  const inputRef = useRef<HTMLInputElement>(null)

  // The field is the page, so it takes focus on arrival — but `preventScroll`,
  // because the plain `autoFocus` attribute makes the browser scroll the input
  // into view and a visitor lands halfway down the gallery having never seen
  // the hero.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const videoId = useMemo(() => parseVideoId(url), [url])
  const picked = KINDS.find((k) => k.value === kind)!
  const typed = url.trim() !== ''
  const status: Status = busy
    ? 'working'
    : error
      ? 'error'
      : videoId
        ? 'ready'
        : 'idle'

  // The video's real title, read off YouTube's public oEmbed endpoint. It does
  // double duty: the preview strip below proves the right video is queued, and
  // the same string becomes the new track's title, so a student never lands on
  // "Untitled track".
  //
  // Stamped with the id it describes rather than cleared on every keystroke —
  // a stale title then simply fails the `meta.videoId === videoId` guard at
  // both use sites, with no second render to throw it away.
  const [meta, setMeta] = useState<{ videoId: string; title: string } | null>(
    null,
  )
  useEffect(() => {
    if (!videoId) return
    let alive = true
    // Debounced: a paste fires one fetch, but typing an id by hand shouldn't
    // fire eleven.
    const t = setTimeout(() => {
      void fetchVideoTitle(videoId).then((title) => {
        if (alive && title) setMeta({ videoId, title })
      })
    }, 300)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [videoId])

  async function start(init?: { videoId: string; url: string }) {
    if (busy) return
    setBusy(init ? 'link' : 'blank')
    setError(null)
    try {
      const title =
        init && meta?.videoId === init.videoId
          ? meta.title
          : init
            ? ((await fetchVideoTitle(init.videoId)) ?? undefined)
            : undefined
      const session = await startGuestTrack({
        title,
        source: init
          ? { type: 'youtube', youtubeUrl: init.url, videoId: init.videoId }
          : undefined,
        // 'notes' is the absence of a kind, exactly as App's createProject
        // writes it — a classic track carries no settings at all.
        kind: kind === 'sections' ? 'structure' : undefined,
      })
      // Land on the private, key-bearing URL so a reload (or a copied address
      // bar) still reaches the project. startGuestTrack has stored the key.
      window.location.assign(
        `${window.location.pathname}?track=${session.projectId}&key=${session.key}`,
      )
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes('Too many')
          ? 'Too many tracks started on this network right now. Wait a few minutes, or sign in instead.'
          : 'Couldn’t start the track. Check your connection and try again.',
      )
      setBusy(null)
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Paste a YouTube link to start.')
      inputRef.current?.focus()
      return
    }
    if (!videoId) {
      setError(
        'That isn’t a YouTube link. Copy the URL from the address bar, or from the video’s Share button.',
      )
      inputRef.current?.focus()
      return
    }
    void start({ videoId, url: trimmed })
  }

  return (
    /* Same 1180 container and gutters as the gallery below, with the hero's
       own content capped narrower inside it — so both blocks share one left
       edge and the page reads as one column, not two stacked pages. */
    <section className="flex min-h-[74vh] flex-col justify-center px-4 py-14 sm:px-6">
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="w-full max-w-[760px]">
          {/* Landing type runs bigger than the app's own display step (DESIGN.md
              §3 caps in-app display at 1.25rem). This is the one surface that has
              to explain the tool to a stranger, so the headline gets room — and
              the size stops well short of a marketing shout. */}
          <h1
            className="animate-rise-in text-[clamp(1.75rem,5.5vw,2.75rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-fg-strong"
            style={{ textWrap: 'balance' }}
          >
            Annotate music by the moment.
          </h1>

          {/* ---- the source panel ---- */}
          {/* No standfirst under the headline: the panel is one row now, so it
              sits high enough that a paragraph explaining it would only push
              the thing it explains further down. What each workspace does is
              in the menu, at the moment of choosing. */}
          <form
            onSubmit={submit}
            className="mt-8 animate-panel-in overflow-hidden rounded-lg border border-line bg-panel"
            style={{ animationDelay: '120ms' }}
          >
            <div className="flex h-10 items-center gap-2 border-b border-line bg-raised px-3.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                New track
              </span>
              <span className="flex-1" />
              <StatusReadout status={status} />
            </div>

            <div className="p-3.5 sm:p-4">
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <div className="relative flex-1">
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[13px] transition-colors ${
                      videoId ? 'text-accentink' : 'text-muted'
                    }`}
                  >
                    ▶
                  </span>
                  <input
                    ref={inputRef}
                    value={url}
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={busy != null}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      setError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setUrl('')
                        setError(null)
                      }
                    }}
                    placeholder="https://www.youtube.com/watch?v=…"
                    aria-label="YouTube link"
                    aria-invalid={status === 'error'}
                    /* Placeholder at full muted, not a fraction of it: this is
                       the page's one field, and DESIGN.md §5 holds placeholders
                       to 4.5:1 — muted/80 on the light inset well misses it. */
                    className="bevel-inset h-12 w-full rounded border border-line bg-inset pl-9 pr-9 text-[15px] text-fg outline-none transition-colors placeholder:text-muted focus:border-accent disabled:opacity-60"
                  />
                  {typed && busy == null && (
                    <button
                      type="button"
                      onClick={() => {
                        setUrl('')
                        setError(null)
                        inputRef.current?.focus()
                      }}
                      title="Clear"
                      aria-label="Clear the link"
                      className="press absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-fg"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                {/* Left of the key, reading as one control group with it: pick
                    the workspace, then press the thing that starts it. */}
                <KindMenu
                  value={kind}
                  onChange={setKind}
                  disabled={busy != null}
                />
                <button
                  type="submit"
                  disabled={busy != null}
                  /* Fixed to the longest label, like the trigger beside it, so
                     the row holds still while the workspace changes. */
                  className="press bevel-raised inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded bg-accent px-5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-onaccent hover:brightness-110 disabled:cursor-wait disabled:opacity-70 sm:w-[194px]"
                >
                  {busy === 'link' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Play size={15} />
                  )}
                  {/* The key names the job it's about to start, so the choice
                      beside it stays legible right up to the click. */}
                  {busy === 'link' ? 'Starting…' : picked.action}
                </button>
              </div>

              {error && (
                <p
                  role="alert"
                  className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-snug text-danger"
                >
                  <TriangleAlert size={13} className="mt-[2px] shrink-0" />
                  {error}
                </p>
              )}

              {videoId && !error && (
                  <QueuedVideo
                  videoId={videoId}
                  title={meta?.videoId === videoId ? meta.title : null}
                />
              )}
            </div>
          </form>

          {/* The two ways past the panel. Quiet by design: the panel is the
              action. The "keep your private link" warning that used to lead
              this line is gone from here — GuestLinkBar states it across the
              top of the editor, where the work that could be lost actually
              exists. */}
          <div
            className="mt-3.5 flex animate-rise-in flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted"
            style={{ animationDelay: '180ms' }}
          >
            <button
              type="button"
              disabled={busy != null}
              onClick={() => void start()}
              className="press rounded text-fg underline decoration-line underline-offset-[3px] transition-colors hover:decoration-accent disabled:opacity-60"
            >
              {busy === 'blank' ? 'Starting…' : 'Start without a link'}
            </button>
            <span aria-hidden className="text-muted/50">
              ·
            </span>
            {/* Scrolls to the gallery below rather than opening ?browse=1 —
                that page is the same list, and sending someone away from the
                paste field to see what's already under it is a dead end. */}
            <button
              type="button"
              onClick={() =>
                document.getElementById(PUBLISHED_ID)?.scrollIntoView({
                  behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                    .matches
                    ? 'auto'
                    : 'smooth',
                  block: 'start',
                })
              }
              className="press rounded text-fg underline decoration-line underline-offset-[3px] transition-colors hover:decoration-accent"
            >
              See published tracks
            </button>
          </div>

            {history.length > 0 && (
              <DeviceTracks
                tracks={history}
                onForget={(id) => {
                  forgetGuestTrack(id)
                  setHistory(guestHistory())
                }}
              />
            )}
        </div>
      </div>
    </section>
  )
}

/* ---- workspace menu ------------------------------------------------------- */

/**
 * Which workspace the link opens into, as the app's own dropdown device — the
 * same shape as the signed-in home page's New-track menu (trigger with a
 * chevron, rows of icon + name + one line of what it is).
 *
 * A menu rather than a visible switch because the panel is one row: the choice
 * sits inside the control group it affects, immediately left of the key that
 * acts on it, and the explanation of each workspace arrives at the moment
 * someone is actually choosing between them rather than sitting on the page
 * being read past.
 */
function KindMenu({
  value,
  onChange,
  disabled,
}: {
  value: TrackKind
  onChange: (v: TrackKind) => void
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const picked = KINDS.find((k) => k.value === value)!
  const PickedIcon = picked.Icon

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Track type: ${picked.label}`}
        title="What this track is for"
        /* Fixed width from the desktop breakpoint up: the two labels differ in
           length, and letting the trigger resize would twitch the input beside
           it every time the workspace changes. */
        className="press flex h-12 w-full shrink-0 items-center gap-2 rounded border border-line bg-inset px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fg transition-colors hover:border-line-strong disabled:opacity-60 sm:w-[178px]"
      >
        <PickedIcon size={13} className="shrink-0 text-accentink/80" />
        <span className="flex-1 text-left">{picked.label}</span>
        <ChevronDown
          size={11}
          className={`shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>
      <Popover
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={278}
      >
        <div
          role="menu"
          className="overflow-hidden rounded border border-line bg-panel py-1 shadow-lg shadow-black/40"
        >
          {KINDS.map((k) => {
            const Icon = k.Icon
            const on = k.value === value
            return (
              <button
                key={k.value}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                onClick={() => {
                  setOpen(false)
                  onChange(k.value)
                }}
                className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-raised"
              >
                <Icon size={14} className="mt-[1px] shrink-0 text-accentink/80" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold text-fg">
                    {k.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                    {k.detail}
                  </span>
                </span>
                <Check
                  size={12}
                  className={`mt-[3px] shrink-0 text-accentink ${on ? '' : 'opacity-0'}`}
                />
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}

/* ---- panel readout -------------------------------------------------------- */

/** The panel's LED: what the instrument makes of what's been typed into it. */
function StatusReadout({ status }: { status: Status }) {
  const text =
    status === 'working'
      ? 'Starting'
      : status === 'ready'
        ? 'Ready'
        : status === 'error'
          ? 'No link'
          : 'Awaiting link'
  return (
    <span
      aria-live="polite"
      className={`flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] ${
        status === 'error' ? 'text-danger' : status === 'idle' ? 'text-muted' : 'led'
      }`}
    >
      <span
        aria-hidden
        className={`h-[7px] w-[7px] rounded-full ${
          status === 'error'
            ? 'bg-danger'
            : status === 'idle'
              ? 'bg-muted/40'
              : 'animate-now-pulse bg-accent'
        }`}
      />
      {text}
    </span>
  )
}

/* ---- queued video --------------------------------------------------------- */

/**
 * The parsed link, read back as the app's own cover well: proof that the right
 * video is about to open, before anything is created. Same device as a library
 * tile's cover, at strip scale — a dead or private video falls through to the
 * generated waveform mark exactly as a tile would.
 */
function QueuedVideo({
  videoId,
  title,
}: {
  videoId: string
  title: string | null
}) {
  const theme = useResolvedTheme()
  // Which id's thumbnail 404'd — not a bare boolean, so pasting a second link
  // isn't greyed out by the first one's dead thumb.
  const [brokenId, setBrokenId] = useState<string | null>(null)
  const thumbBroken = brokenId === videoId

  return (
    <div className="mt-3.5 flex animate-rise-in items-center gap-3 rounded border border-line bg-inset p-2">
      <div className="relative aspect-video w-[104px] shrink-0 overflow-hidden rounded-sm border border-line bg-inset">
        {thumbBroken ? (
          <WaveArt id={videoId} theme={theme} />
        ) : (
          <img
            src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => setBrokenId(videoId)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold text-fg-strong">
          {title ?? 'Reading the video…'}
        </p>
        <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
          YouTube · {videoId}
        </p>
      </div>
    </div>
  )
}

/* ---- this device's guest tracks ------------------------------------------- */

/**
 * Every guest track this browser holds a key to.
 *
 * A guest has no library on the server — the key is the only credential and it
 * lives in a URL — so starting a second track used to overwrite the only
 * pointer to the first. This strip is that pointer, kept locally: not a
 * library, just an honest record of what this machine started, so nothing gets
 * stranded by a second visit to the front page.
 */
function DeviceTracks({
  tracks,
  onForget,
}: {
  tracks: GuestTrackRef[]
  onForget: (projectId: string) => void
}) {
  return (
    <div
      className="mt-9 animate-rise-in border-t border-line pt-5"
      style={{ animationDelay: '240ms' }}
    >
      <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        On this device — {tracks.length}
      </h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {tracks.map((t) => (
          <li key={t.projectId} className="flex">
            <a
              href={guestTrackUrl(t)}
              title={`Open “${t.title}”`}
              className="press flex max-w-[280px] items-center gap-1.5 rounded-l border border-r-0 border-line bg-panel py-1.5 pl-2.5 pr-2 text-[12.5px] text-fg transition-colors hover:border-line-strong hover:bg-raised"
            >
              {/* Which workspace it opens into — the same Blocks/Pencil pair
                  the switch above uses, so a chip says what you'd be going
                  back to. */}
              {t.kind === 'structure' ? (
                <Blocks size={12} className="shrink-0 text-muted" aria-hidden />
              ) : (
                <Pencil size={12} className="shrink-0 text-muted" aria-hidden />
              )}
              <span className="truncate">{t.title}</span>
              <ArrowRight size={12} className="shrink-0 text-muted" />
            </a>
            <button
              type="button"
              onClick={() => onForget(t.projectId)}
              title="Forget this track on this device (it isn’t deleted)"
              aria-label={`Forget ${t.title} on this device`}
              className="press grid w-7 place-items-center rounded-r border border-line text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-fg"
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ---- published gallery ---------------------------------------------------- */

function PublishedSection() {
  return (
    /* Padding on the section (not inside the 1180 box) so this block's left
       edge lands exactly on the hero's. Stays on ink too: the gallery's tiles
       are panel-filled, and a panel-filled section behind them would flatten
       the whole grid into one surface. */
    <section
      id={PUBLISHED_ID}
      /* Clears the sticky masthead when the hero scrolls down to here. */
      className="scroll-mt-[54px] border-t border-line px-4 py-10 sm:px-6"
    >
      <div className="mx-auto w-full max-w-[1180px]">
        <div className="mb-6">
          <h2 className="text-xl font-semibold tracking-tight text-fg-strong">
            Published tracks
          </h2>
          <p className="mt-1 max-w-[64ch] text-[13px] text-muted">
            Analyses teachers have published on this station. Open one to listen
            through its notes — no account needed — or sign in to copy it into a
            library of your own.
          </p>
        </div>
        <BrowseGallery />
      </div>
    </section>
  )
}
