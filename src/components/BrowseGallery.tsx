// The public Browse gallery: every published track as a Station Card. Used in
// two places — the Browse view on the signed-in home page, and the anonymous
// `?browse` route (see PublicBrowsePage below / main.tsx). Opening a card
// routes into the read-only share viewer (`?view=`), where "Make a copy"
// clones the track into the visitor's own library: publish → browse → copy →
// annotate is the classroom loop.
import { useEffect, useMemo, useState } from 'react'
import { Globe, Play, RefreshCw, Search, X } from 'lucide-react'
import type { BrowseItem } from '../types'
import { fetchBrowse } from '../lib/projectStore'
import { formatRelativeTime } from '../lib/format'
import { useResolvedTheme, type ResolvedTheme } from '../lib/theme'
import { useAuth } from '../lib/auth'
import { WaveArt, CueLine } from './trackArt'

type Status = 'loading' | 'ready' | 'error'

// One gallery fetch per page load: the list is small, changes rarely, and a
// tab flip back to Browse shouldn't re-skeleton. Module-level on purpose.
let cache: BrowseItem[] | null = null

const stagger = (i: number) => `${Math.min(i, 11) * 40}ms`

export default function BrowseGallery() {
  const theme = useResolvedTheme()
  const { user } = useAuth()
  const [items, setItems] = useState<BrowseItem[] | null>(cache)
  const [status, setStatus] = useState<Status>(cache ? 'ready' : 'loading')
  const [query, setQuery] = useState('')

  // Kicked from mount (below) and the error state's Retry. State flips only
  // inside the async continuations — never synchronously in the effect body.
  const fill = () =>
    fetchBrowse().then(
      (list) => {
        cache = list
        setItems(list)
        setStatus('ready')
      },
      () => setStatus('error'),
    )
  const retry = () => {
    setStatus('loading')
    void fill()
  }
  useEffect(() => {
    if (!cache) void fill()
  }, [])

  const q = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      (items ?? []).filter(
        (it) =>
          !q ||
          it.title.toLowerCase().includes(q) ||
          it.publishedByName.toLowerCase().includes(q),
      ),
    [items, q],
  )

  if (status === 'error')
    return (
      <div className="flex flex-col items-center gap-3 rounded border border-dashed border-line py-14 text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Couldn’t load the gallery
        </p>
        <p className="max-w-xs text-[12px] leading-relaxed text-muted/70">
          Check your connection, then try again.
        </p>
        <button
          type="button"
          onClick={retry}
          className="press inline-flex items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fg hover:border-line-strong"
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    )

  if (status === 'loading')
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="animate-pulse overflow-hidden rounded border border-line bg-panel"
            style={{ animationDelay: stagger(i) }}
          >
            <div className="aspect-video w-full border-b border-line bg-inset" />
            <div className="space-y-2 p-3.5">
              <div className="h-3 w-3/4 rounded-sm bg-raised" />
              <div className="h-2.5 w-1/2 rounded-sm bg-raised/70" />
            </div>
          </div>
        ))}
      </div>
    )

  if ((items ?? []).length === 0)
    return (
      <div className="flex flex-col items-center gap-3 rounded border border-dashed border-line py-14 text-center">
        <Globe size={22} className="text-muted/50" />
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Nothing published yet
        </p>
        <p className="max-w-sm text-[12px] leading-relaxed text-muted/70">
          Publish one of your tracks from its Share panel — it appears here for
          anyone to open, listen through, and copy into their own library.
        </p>
      </div>
    )

  return (
    <>
      <div className="relative mb-8 max-w-[520px]">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
          placeholder="Search published tracks…"
          aria-label="Search published tracks"
          className="bevel-inset w-full rounded border border-line bg-inset py-2 pl-9 pr-8 text-sm text-fg outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
        />
        {q !== '' && (
          <button
            type="button"
            onClick={() => setQuery('')}
            title="Clear search"
            aria-label="Clear search"
            className="press absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-sm text-muted">
          No published tracks match “{query.trim()}”.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
          {visible.map((it, i) => (
            <BrowseTile
              key={it.id}
              item={it}
              theme={theme}
              mine={user?.uid === it.ownerId}
              enterDelay={stagger(i)}
            />
          ))}
        </div>
      )}
    </>
  )
}

/* ---- anonymous route ------------------------------------------------------ */

/**
 * The standalone `?browse` page — the gallery with the app's dark masthead,
 * rendered outside the auth Gate (see main.tsx). Signed-out visitors get a
 * sign-in path; signed-in ones a way back to their library.
 */
export function PublicBrowsePage() {
  const { user, loading } = useAuth()
  useEffect(() => {
    document.title = 'Browse — Sound Annotator'
  }, [])
  return (
    <div className="flex h-full flex-col bg-ink text-fg">
      <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-line bg-panel px-4">
        <span className="h-[9px] w-[9px] shrink-0 rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-fg">
          Sound&nbsp;Annotator
        </span>
        <span className="flex h-[26px] items-center gap-1 rounded border border-accent/60 bg-accent/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink">
          <Globe size={11} /> Browse
        </span>
        <span className="flex-1" />
        {!loading && (
          <a
            href={window.location.pathname}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            {user ? 'Your library' : 'Sign in'}
          </a>
        )}
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-fg-strong">
              Published tracks
            </h1>
            <p className="mt-1 text-[13px] text-muted">
              Annotated analyses published by teachers on this station — open
              one to listen through its notes, or copy it into your own
              library.
            </p>
          </div>
          <BrowseGallery />
        </div>
      </main>
    </div>
  )
}

/* ---- one published track -------------------------------------------------- */

function BrowseTile({
  item: it,
  theme,
  mine,
  enterDelay,
}: {
  item: BrowseItem
  theme: ResolvedTheme
  mine: boolean
  enterDelay: string
}) {
  const [thumbBroken, setThumbBroken] = useState(false)
  const open = () => {
    window.location.href = `${window.location.pathname}?view=${it.id}`
  }
  return (
    <div
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
      role="link"
      tabIndex={0}
      aria-label={`Open ${it.title} by ${it.publishedByName} (read-only)`}
      style={{ animationDelay: enterDelay }}
      className="group flex animate-tile-in cursor-pointer flex-col overflow-hidden rounded border border-line bg-panel transition duration-200 ease-instr focus-visible:border-accent focus-visible:outline-none hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/10"
    >
      <div className="relative aspect-video w-full overflow-hidden border-b border-line bg-inset">
        <div className="absolute inset-0 transition-transform duration-700 ease-instr group-hover:scale-[1.04]">
          {it.videoId && !thumbBroken ? (
            <img
              src={`https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => setThumbBroken(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <WaveArt id={it.id} theme={theme} />
          )}
        </div>
        {/* Listen affordance — rises with the cover on hover/focus so the
            card reads "opens a player", not "opens an editor". */}
        <div className="absolute inset-x-0 bottom-0 flex justify-end p-2 opacity-0 transition-opacity duration-200 group-focus-visible:opacity-100 group-hover:opacity-100">
          <span className="flex items-center gap-1 rounded border border-line-strong bg-ink/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-fg backdrop-blur-sm">
            <Play size={10} /> Listen
          </span>
        </div>
      </div>
      <div className="mx-3.5 mt-3 h-3 shrink-0">
        <CueLine notes={it.ticks} theme={theme} />
      </div>
      <div className="px-3.5 pt-1.5">
        <p
          title={it.title}
          className="truncate text-sm font-semibold tracking-wide text-fg-strong"
        >
          {it.title}
        </p>
        <p className="mt-0.5 truncate text-[12px] text-muted">
          by <span className="text-fg">{it.publishedByName}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pb-3.5 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
        <span>
          {it.noteCount} {it.noteCount === 1 ? 'note' : 'notes'}
        </span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(it.publishedAt || it.updatedAt)}</span>
        {mine && (
          <span className="flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-1 py-px text-accentink">
            <Globe size={10} /> Yours
          </span>
        )}
      </div>
    </div>
  )
}
