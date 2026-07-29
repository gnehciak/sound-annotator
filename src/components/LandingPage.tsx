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
  Loader2,
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
import BrowseGallery from './BrowseGallery'
import { WaveArt } from './trackArt'

/** What the panel's readout is saying — the instrument reading its input. */
type Status = 'idle' | 'ready' | 'working' | 'error'

/** Scroll target for the hero's link down to the gallery. */
const PUBLISHED_ID = 'published-tracks'

export default function LandingPage({ onSignIn }: { onSignIn: () => void }) {
  const { pref, setPref, resolved, palette, setPalette } = useTheme()

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-ink text-fg">
      {/* The app's own masthead, unchanged — the first thing a visitor sees is
          the thing they'll be looking at all lesson. */}
      <header className="sticky top-0 z-10 flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-fg">
          Sound&nbsp;Annotator
        </span>
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
  const inputRef = useRef<HTMLInputElement>(null)

  // The field is the page, so it takes focus on arrival — but `preventScroll`,
  // because the plain `autoFocus` attribute makes the browser scroll the input
  // into view and a visitor lands halfway down the gallery having never seen
  // the hero.
  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true })
  }, [])

  const videoId = useMemo(() => parseVideoId(url), [url])
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
          <p
            className="mt-4 max-w-[54ch] animate-rise-in text-[15px] leading-relaxed text-muted"
            style={{ animationDelay: '60ms', textWrap: 'pretty' }}
          >
            Paste a YouTube link and pin rich-text notes to exact timestamps.
            Click a note and the player seeks to it. No account needed to start.
          </p>

          {/* ---- the source panel ---- */}
          <form
            onSubmit={submit}
            className="mt-8 animate-panel-in overflow-hidden rounded-lg border border-line bg-panel"
            style={{ animationDelay: '120ms' }}
          >
            <div className="flex h-10 items-center gap-2 border-b border-line bg-raised px-3.5">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
                Source
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
                    aria-describedby="source-help"
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
                <button
                  type="submit"
                  disabled={busy != null}
                  className="press bevel-raised inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded bg-accent px-5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-onaccent hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
                >
                  {busy === 'link' ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Play size={15} />
                  )}
                  {busy === 'link' ? 'Starting…' : 'Start annotating'}
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

          {/* One line of the truth a guest has to know, and the two ways out of
              it. Quiet by design: the panel above is the action. */}
          <div
            id="source-help"
            className="mt-3.5 flex animate-rise-in flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted"
            style={{ animationDelay: '180ms' }}
          >
            <span>
              Your work lives at a private link — keep it, or you lose access.
            </span>
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
      <p className="mt-1.5 text-[12.5px] text-muted">
        Guest tracks you started here. They’re only remembered in this browser —
        the private link is the one that travels.
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {tracks.map((t) => (
          <li key={t.projectId} className="flex">
            <a
              href={guestTrackUrl(t)}
              title={`Open “${t.title}”`}
              className="press flex max-w-[280px] items-center gap-1.5 rounded-l border border-r-0 border-line bg-panel py-1.5 pl-2.5 pr-2 text-[12.5px] text-fg transition-colors hover:border-line-strong hover:bg-raised"
            >
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
