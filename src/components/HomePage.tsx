import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Eye,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { Annotation, Folder, Project } from '../types'
import { formatRelativeTime } from '../lib/format'
import { colorForId, hueText } from '../lib/noteColors'
import { useResolvedTheme, type ResolvedTheme } from '../lib/theme'
import { useAuth } from '../lib/auth'
import Popover from './Popover'

interface Props {
  projects: Project[]
  folders: Folder[]
  /** Open folder (null = root library). Owned by App so it survives editor trips. */
  openFolderId: string | null
  onOpenFolder: (id: string | null) => void
  onOpenTrack: (id: string) => void
  /** Creates in the open folder (App reads openFolderId) and opens the editor. */
  onCreateTrack: () => void
  onDeleteTrack: (id: string) => void
  onMoveTrack: (id: string, folderId: string | null) => void
  /** Optimistically creates "New folder" and returns its id. */
  onCreateFolder: () => string
  onRenameFolder: (id: string, name: string) => void
  /** Moves the folder's tracks back to the root, then deletes it. */
  onDeleteFolder: (id: string) => void
}

// Drag payload type for moving tracks between folders. A custom MIME keeps
// folder tiles inert for anything else dragged across the page (OS files).
const TRACK_MIME = 'application/x-sound-annotator-track'

/** True while a track-tile drag is over this event's target. */
const hasTrack = (e: React.DragEvent) =>
  e.dataTransfer.types.includes(TRACK_MIME)

/** The rack's old source glyph: video / audio / no source yet. */
const sourceGlyph = (p: Project) =>
  p.source?.type === 'youtube' ? '▶' : p.source?.type === 'audio' ? '♪' : '·'

/** Time-of-day salutation for the library greeting. */
const salutation = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/**
 * Stagger helper for the dashboard cascade: base delay plus a per-index step,
 * clamped so a long list doesn't make the last tile feel late. Returns a string
 * suitable for `style={{ animationDelay }}`.
 */
const stagger = (base: number, i: number) => `${base + Math.min(i, 11) * 40}ms`

/**
 * The home page: the signed-in landing view listing every track as a tile,
 * grouped into flat folders (Drive semantics — the root shows folder tiles
 * plus the tracks that live outside any folder; clicking a folder drills in).
 * Tracks move between folders by drag-and-drop onto a folder tile (or the
 * Library crumb to unfile) and through each tile's "move to" menu. All data
 * mutations live in App; this component owns only ephemeral UI state.
 *
 * Visual scheme ("Station Cards"): every track leads with its cover — the
 * YouTube thumbnail, or a waveform mark generated from the track id — over a
 * slim cue line drawing each note as a tick at its real position in its own
 * hue. Folders are hue-coded cards. Same flush-panel/hairline language as the
 * editor; the warmth comes from the covers and the note colors, not the chrome.
 */
export default function HomePage({
  projects,
  folders,
  openFolderId,
  onOpenFolder,
  onOpenTrack,
  onCreateTrack,
  onDeleteTrack,
  onMoveTrack,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const theme = useResolvedTheme()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  // Folder tile currently in inline-rename mode (a fresh folder starts there).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // The Library crumb lights up while a dragged track may be dropped on it.
  const [crumbOver, setCrumbOver] = useState(false)
  // Cascading window — true while the staggered welcome is playing, false once
  // it's done. Resets whenever the user navigates between folders so the
  // greeting replays on the new view. After it closes, freshly-mounted tiles
  // (a new folder, search-clear restoring filtered tracks) rise on their own
  // with no stagger — instant feedback for a deliberate click, instead of
  // waiting for a phantom slot at the tail of the cascade.
  const [cascading, setCascading] = useState(true)
  const [lastFolderId, setLastFolderId] = useState(openFolderId)
  if (lastFolderId !== openFolderId) {
    setLastFolderId(openFolderId)
    setCascading(true)
  }
  useEffect(() => {
    // 1.2s covers header rise (~320ms) + tracks-heading delay (240ms) + 12-tile
    // cap stagger (440ms) + animation duration (420ms) with a small margin.
    const t = setTimeout(() => setCascading(false), 1200)
    return () => clearTimeout(t)
  }, [openFolderId])

  const folderIds = useMemo(() => new Set(folders.map((f) => f.id)), [folders])
  // A folderId pointing at a deleted folder (removed on another device) groups
  // as unfiled; the stale id heals on the project's next natural save.
  const folderOf = (p: Project) =>
    p.folderId && folderIds.has(p.folderId) ? p.folderId : null

  // A dangling openFolderId (folder deleted elsewhere) falls back to the root.
  const openFolder = folders.find((f) => f.id === openFolderId) ?? null

  const sorted = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  )
  const q = query.trim().toLowerCase()
  const searching = q !== ''
  // Searching spans every folder; browsing shows only the open one's tracks.
  const visible = searching
    ? sorted.filter((p) => p.title.toLowerCase().includes(q))
    : sorted.filter((p) => folderOf(p) === (openFolder?.id ?? null))

  // Per-folder track + note tallies for the folder cards' meta line.
  const counts = useMemo(() => {
    const m = new Map<string | null, { tracks: number; notes: number }>()
    for (const p of projects) {
      const k = p.folderId && folderIds.has(p.folderId) ? p.folderId : null
      const c = m.get(k) ?? { tracks: 0, notes: 0 }
      c.tracks += 1
      c.notes += p.annotations.length
      m.set(k, c)
    }
    return m
  }, [projects, folderIds])

  const empty = projects.length === 0 && folders.length === 0
  const firstName = user?.displayName?.trim().split(/\s+/)[0]

  return (
    <main className="flex min-h-0 min-w-0 flex-1 animate-fade-in flex-col">
      <div className="flex-1 overflow-y-auto">
        {empty ? (
          /* First run: nothing at all yet — the old editor empty state's hero. */
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="text-5xl">🎛️</div>
            <h2 className="text-lg font-semibold text-fg">
              Annotate a piece of music
            </h2>
            <p className="max-w-sm text-sm text-muted">
              Add a YouTube video or an audio file, then pin notes to any moment
              (or a whole section) with text, lists, and screenshots.
            </p>
            <button
              type="button"
              onClick={onCreateTrack}
              className="press inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accentink hover:bg-accent/20"
            >
              <Plus size={14} /> New track
            </button>
          </div>
        ) : (
          /* The key replays the stagger cascade on every folder navigation —
             root → folder → root all re-enter as a fresh listening station,
             not a snap. Search refines in place (no remount) so typing stays
             live. */
          <div
            key={openFolderId ?? 'root'}
            className="mx-auto w-full max-w-[1180px] px-4 py-7 sm:px-6"
          >
            {/* Top block: greeting at the root, breadcrumb inside a folder. */}
            <div
              className="mb-6 flex animate-rise-in items-start justify-between gap-4"
              style={{ animationDelay: stagger(0, 0) }}
            >
              {openFolder ? (
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    {/* The root crumb doubles as the "unfile" drop target. */}
                    <button
                      type="button"
                      onClick={() => onOpenFolder(null)}
                      onDragOver={(e) => {
                        if (!hasTrack(e)) return
                        e.preventDefault()
                        e.dataTransfer.dropEffect = 'move'
                        setCrumbOver(true)
                      }}
                      onDragLeave={() => setCrumbOver(false)}
                      onDrop={(e) => {
                        if (!hasTrack(e)) return
                        e.preventDefault()
                        setCrumbOver(false)
                        onMoveTrack(e.dataTransfer.getData(TRACK_MIME), null)
                      }}
                      title="Back to the library (drop a track here to move it out)"
                      className={`press rounded border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                        crumbOver
                          ? 'border-accent bg-accent/10 text-accentink'
                          : 'border-transparent text-muted hover:text-fg'
                      }`}
                    >
                      Library
                    </button>
                    <span aria-hidden className="text-muted">
                      ›
                    </span>
                    <h1 className="flex min-w-0 items-center gap-2 truncate text-xl font-semibold tracking-tight text-fg-strong">
                      <FolderIcon
                        size={16}
                        className="shrink-0"
                        style={{
                          color: hueText(colorForId(openFolder.id), theme),
                        }}
                      />
                      {openFolder.name}
                    </h1>
                  </div>
                </div>
              ) : (
                <div className="min-w-0">
                  <h1 className="truncate text-xl font-semibold tracking-tight text-fg-strong">
                    {salutation()}
                    {firstName ? `, ${firstName}` : ''}
                  </h1>
                  <p className="mt-1 text-[13px] text-muted">
                    Pick up a track, or bring in something new to annotate.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={onCreateTrack}
                className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink hover:bg-accent/20"
              >
                <Plus size={13} />
                <span className="hidden sm:inline">New track</span>
              </button>
            </div>

            {/* Search well — spans every folder, like the old sub-bar's. */}
            <div
              className="relative mb-8 max-w-[520px] animate-rise-in"
              style={{ animationDelay: stagger(60, 0) }}
            >
              <Search
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
                placeholder="Search your tracks…"
                aria-label="Search all tracks"
                className="bevel-inset w-full rounded border border-line bg-inset py-2 pl-9 pr-8 text-sm text-fg outline-none transition-colors placeholder:text-muted/70 focus:border-accent"
              />
              {searching && (
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

            {/* Folder cards — root only, and hidden while a search is on. */}
            {!searching && !openFolder && (
              <section className="mb-8">
                <h2
                  className="mb-2.5 animate-rise-in font-mono text-[10px] uppercase tracking-[0.2em] text-muted"
                  style={{ animationDelay: stagger(100, 0) }}
                >
                  Folders
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {folders.map((f, i) => (
                    <FolderTile
                      key={f.id}
                      folder={f}
                      theme={theme}
                      tracks={counts.get(f.id)?.tracks ?? 0}
                      notes={counts.get(f.id)?.notes ?? 0}
                      renaming={renamingId === f.id}
                      enterDelay={cascading ? stagger(140, i) : '0ms'}
                      onOpen={() => onOpenFolder(f.id)}
                      onStartRename={() => setRenamingId(f.id)}
                      onRename={(name) => {
                        setRenamingId(null)
                        onRenameFolder(f.id, name)
                      }}
                      onCancelRename={() => setRenamingId(null)}
                      onDelete={() => onDeleteFolder(f.id)}
                      onDropTrack={(id) => onMoveTrack(id, f.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => setRenamingId(onCreateFolder())}
                    style={{
                      animationDelay: cascading
                        ? stagger(140, folders.length)
                        : '0ms',
                    }}
                    className="press flex min-h-[58px] animate-tile-in items-center justify-center gap-2 rounded border border-dashed border-line font-mono text-[11px] uppercase tracking-[0.1em] text-muted transition-colors hover:border-line-strong hover:text-fg"
                  >
                    <FolderPlus size={13} /> New folder
                  </button>
                </div>
              </section>
            )}

            {(() => {
              /* Stack the tracks section onto the same cascade. When folder
                 cards are above, the heading waits for the folders to finish;
                 inside a folder (or while searching) it follows the search well
                 directly. */
              const tracksHeadDelay =
                !searching && !openFolder ? 240 : 120
              const tilesBaseDelay = tracksHeadDelay + 40
              return (
                <section>
                  <h2
                    className="mb-2.5 animate-rise-in font-mono text-[10px] uppercase tracking-[0.2em] text-muted"
                    style={{ animationDelay: stagger(tracksHeadDelay, 0) }}
                  >
                    {searching
                      ? `Results — ${visible.length}`
                      : openFolder
                        ? `Tracks — ${visible.length}`
                        : 'Tracks'}
                  </h2>
                  {visible.length === 0 ? (
                    searching ? (
                      <p
                        className="animate-rise-in py-6 text-sm text-muted"
                        style={{ animationDelay: stagger(tilesBaseDelay, 0) }}
                      >
                        No tracks match “{query.trim()}”.
                      </p>
                    ) : openFolder ? (
                      <div
                        className="flex animate-tile-in flex-col items-center gap-3 rounded border border-dashed border-line py-12 text-center"
                        style={{ animationDelay: stagger(tilesBaseDelay, 0) }}
                      >
                        <FolderIcon size={22} className="text-muted/50" />
                        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                          Nothing in this folder yet
                        </p>
                        <p className="max-w-xs text-[12px] leading-relaxed text-muted/70">
                          Create a track here, or go back to the library and
                          drag tracks onto this folder.
                        </p>
                        <button
                          type="button"
                          onClick={onCreateTrack}
                          className="press inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink hover:bg-accent/20"
                        >
                          <Plus size={13} /> New track
                        </button>
                      </div>
                    ) : (
                      <p
                        className="animate-rise-in py-4 text-sm text-muted"
                        style={{ animationDelay: stagger(tilesBaseDelay, 0) }}
                      >
                        No tracks outside folders.
                      </p>
                    )
                  ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
                      {visible.map((p, i) => (
                        <TrackTile
                          key={p.id}
                          project={p}
                          theme={theme}
                          folders={folders}
                          enterDelay={
                            cascading ? stagger(tilesBaseDelay, i) : '0ms'
                          }
                          // Search results span folders — label each with its home.
                          folderName={
                            searching
                              ? folders.find((f) => f.id === folderOf(p))
                                  ?.name ?? null
                              : null
                          }
                          onOpen={() => onOpenTrack(p.id)}
                          onDelete={() => {
                            if (confirm(`Delete “${p.title}” and its notes?`))
                              onDeleteTrack(p.id)
                          }}
                          onMove={(folderId) => onMoveTrack(p.id, folderId)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })()}
          </div>
        )}
      </div>
    </main>
  )
}

/* ---- cover art + cue line ------------------------------------------------- */

/**
 * Waveform mark for tracks without a thumbnail (audio files, no source yet,
 * or a dead YouTube thumb). Deterministic from the track id — the same hue
 * rotation the notes use, bars from a seeded LCG — so a track keeps its cover.
 */
function WaveArt({ id, theme }: { id: string; theme: ResolvedTheme }) {
  const bars = useMemo(() => {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
    const n = 26
    const W = 320
    const H = 180
    const bw = 4
    const gap = (W - 60 - n * bw) / (n - 1)
    const out: { x: number; y: number; w: number; h: number }[] = []
    // Seeded LCG, advanced inline per bar (no closure — keeps the memo pure).
    let s = (h || 1) >>> 0
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) % 2147483648
      const t = i / (n - 1)
      const env = Math.sin(t * Math.PI) ** 0.6
      const bh = 8 + (s / 2147483648) * 80 * (0.3 + 0.7 * env)
      out.push({ x: 30 + i * (bw + gap), y: H / 2 - bh / 2, w: bw, h: bh })
    }
    return out
  }, [id])
  // hueText keeps the bars crisp on the pale inset well in light mode.
  const hue = hueText(colorForId(id), theme)
  return (
    <svg
      viewBox="0 0 320 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className="absolute inset-0 h-full w-full"
    >
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={hue} />
      ))}
    </svg>
  )
}

/**
 * The cue line: every note drawn as a tick at its position in the track, in
 * its own colour — the simplified annotation fingerprint. Positions normalise
 * against the last note (track duration isn't stored), which keeps relative
 * spacing honest. Notes with no siblings still read as "annotated".
 */
function CueLine({
  notes,
  theme,
}: {
  notes: Annotation[]
  theme: ResolvedTheme
}) {
  const ticks = useMemo(() => {
    if (notes.length === 0) return []
    const last = Math.max(...notes.map((n) => n.end ?? n.start), 1)
    const scale = last * 1.04 // small right pad so the last tick isn't flush
    return notes.map((n) => ({
      x: 4 + (n.start / scale) * 989,
      color: hueText(n.color ?? colorForId(n.id), theme),
    }))
  }, [notes, theme])
  return (
    <svg
      viewBox="0 0 1000 100"
      preserveAspectRatio="none"
      aria-hidden
      className="h-full w-full"
    >
      <rect
        x={0}
        y={46}
        width={1000}
        height={8}
        style={{ fill: 'rgb(var(--text) / 0.1)' }}
      />
      {ticks.map((t, i) => (
        <rect key={i} x={t.x} y={16} width={7} height={68} fill={t.color} />
      ))}
    </svg>
  )
}

/* ---- folder tile --------------------------------------------------------- */

function FolderTile({
  folder,
  theme,
  tracks,
  notes,
  renaming,
  enterDelay,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
  onDropTrack,
}: {
  folder: Folder
  theme: ResolvedTheme
  tracks: number
  notes: number
  renaming: boolean
  enterDelay: string
  onOpen: () => void
  onStartRename: () => void
  onRename: (name: string) => void
  onCancelRename: () => void
  onDelete: () => void
  onDropTrack: (trackId: string) => void
}) {
  const [over, setOver] = useState(false)
  // Esc cancels the rename, but the input's unmount still fires blur — the
  // flag keeps that trailing blur from committing anyway.
  const cancelledRef = useRef(false)
  // Folder identity hue: same stable id-derived rotation the notes use.
  const hue = colorForId(folder.id)
  const hueInk = hueText(hue, theme)

  return (
    <div
      onClick={() => !renaming && onOpen()}
      onDragOver={(e) => {
        if (!hasTrack(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={(e) => {
        // Moving onto a child element re-fires leave/over; only a true exit
        // clears the highlight (tiles have nested children, unlike SourcePicker).
        if (e.currentTarget.contains(e.relatedTarget as Node)) return
        setOver(false)
      }}
      onDrop={(e) => {
        if (!hasTrack(e)) return
        e.preventDefault()
        setOver(false)
        onDropTrack(e.dataTransfer.getData(TRACK_MIME))
      }}
      style={{ animationDelay: enterDelay }}
      /* `transition` (not just transition-colors) so the rest-frame hover lift
         eases instead of snapping. Lift suppressed while a track is dragging
         over — the accent fill is the affordance there, no need to also float. */
      className={`group flex animate-tile-in cursor-pointer items-center gap-3 rounded border p-3.5 transition duration-200 ease-instr ${
        over
          ? 'border-accent bg-accent/10'
          : 'border-line bg-panel hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/10'
      }`}
    >
      <div
        aria-hidden
        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded"
        style={{ background: `color-mix(in srgb, ${hue} 13%, transparent)` }}
      >
        <FolderIcon size={16} style={{ color: hueInk }} />
      </div>
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            defaultValue={folder.name}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                cancelledRef.current = true
                onRename(e.currentTarget.value)
              } else if (e.key === 'Escape') {
                cancelledRef.current = true
                onCancelRename()
              }
            }}
            onBlur={(e) => {
              if (cancelledRef.current) {
                cancelledRef.current = false
                return
              }
              onRename(e.currentTarget.value)
            }}
            aria-label="Folder name"
            className="w-full rounded-sm border border-accent bg-inset px-1 py-0.5 text-sm font-semibold text-fg outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            title={folder.name}
            className="block w-full truncate text-left text-sm font-semibold tracking-wide text-fg-strong"
          >
            {folder.name}
          </button>
        )}
        <p className="mt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
          {tracks} {tracks === 1 ? 'track' : 'tracks'}
          {notes > 0 && ` · ${notes} ${notes === 1 ? 'note' : 'notes'}`}
        </p>
      </div>
      {!renaming && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onStartRename()
            }}
            title="Rename folder"
            aria-label={`Rename folder ${folder.name}`}
            className="press grid h-[26px] w-[26px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              // Deleting never deletes tracks — they fall back to the library.
              if (
                tracks === 0 ||
                confirm(
                  `Delete folder “${folder.name}”? Its ${tracks} ${
                    tracks === 1 ? 'track moves' : 'tracks move'
                  } back to the library.`,
                )
              )
                onDelete()
            }}
            title="Delete folder (its tracks move back to the library)"
            aria-label={`Delete folder ${folder.name}`}
            className="press grid h-[26px] w-[26px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ---- track tile ----------------------------------------------------------- */

function TrackTile({
  project: p,
  theme,
  folders,
  folderName,
  enterDelay,
  onOpen,
  onDelete,
  onMove,
}: {
  project: Project
  theme: ResolvedTheme
  folders: Folder[]
  /** Shown as a chip on cross-folder search results (null hides it). */
  folderName: string | null
  enterDelay: string
  onOpen: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
}) {
  const n = p.annotations.length
  // YouTube tracks lead with the video's own thumbnail — derived straight from
  // the stored videoId (static image CDN, no API). A 404 (deleted or private
  // video) falls back to the generated waveform mark, like audio tracks.
  const videoId = p.source?.type === 'youtube' ? p.source.videoId : undefined
  const [thumbBroken, setThumbBroken] = useState(false)
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TRACK_MIME, p.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      style={{ animationDelay: enterDelay }}
      /* Hover: subtle lift + soft drop shadow, eased on the house curve. The
         duration here matches FolderTile's so a mixed row of cards floats
         together. */
      className="group flex animate-tile-in cursor-pointer flex-col overflow-hidden rounded border border-line bg-panel transition duration-200 ease-instr hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg hover:shadow-black/10"
    >
      {/* Cover — the tile's "viewer screen": an inset well under a hairline.
          overflow-hidden so the hover ken-burns stays within the well, and the
          inner cover scales rather than the tile chrome — the screen comes
          alive, the frame doesn't. */}
      <div className="relative aspect-video w-full overflow-hidden border-b border-line bg-inset">
        <div className="absolute inset-0 transition-transform duration-700 ease-instr group-hover:scale-[1.04]">
          {videoId && !thumbBroken ? (
            <img
              src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => setThumbBroken(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <WaveArt id={p.id} theme={theme} />
          )}
        </div>
      </div>
      {/* Cue line — the track's notes at their real positions. */}
      <div className="mx-3.5 mt-3 h-3 shrink-0">
        <CueLine notes={p.annotations} theme={theme} />
      </div>
      <div className="flex items-start gap-2 px-3.5 pt-1.5">
        <span aria-hidden className="font-mono text-xs text-accentink/70">
          {sourceGlyph(p)}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          title={p.title}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-wide text-fg-strong"
        >
          {p.title}
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <MoveMenu project={p} folders={folders} onMove={onMove} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            title="Delete track"
            aria-label={`Delete track ${p.title}`}
            className="press grid h-[26px] w-[26px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 pb-3.5 pt-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
        <span>
          {n} {n === 1 ? 'note' : 'notes'}
        </span>
        <span aria-hidden>·</span>
        <span>{formatRelativeTime(p.updatedAt)}</span>
        {p.shared && (
          <span className="flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-1 py-px text-accentink">
            <Eye size={10} /> Shared
          </span>
        )}
        {folderName && (
          <span className="flex min-w-0 items-center gap-1 rounded border border-line px-1 py-px">
            <FolderIcon size={10} className="shrink-0" />
            <span className="truncate">{folderName}</span>
          </span>
        )}
      </div>
    </div>
  )
}

/* ---- "move to folder" menu ------------------------------------------------ */

function MoveMenu({
  project: p,
  folders,
  onMove,
}: {
  project: Project
  folders: Folder[]
  onMove: (folderId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  // Where the track lives now (dangling ids count as the root library).
  const here =
    p.folderId && folders.some((f) => f.id === p.folderId) ? p.folderId : null

  const row = (id: string | null, label: string) => {
    const isHere = id === here
    return (
      <button
        key={id ?? 'root'}
        type="button"
        disabled={isHere}
        onClick={() => {
          setOpen(false)
          onMove(id)
        }}
        className={`flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs transition-colors ${
          isHere ? 'text-muted' : 'text-fg hover:bg-raised'
        }`}
      >
        {id === null ? (
          <span aria-hidden className="w-3.5 shrink-0 text-center font-mono">
            ·
          </span>
        ) : (
          <FolderIcon size={13} className="shrink-0 text-accentink/70" />
        )}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {isHere && <Check size={12} className="shrink-0 text-accentink" />}
      </button>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        title="Move to folder"
        aria-label={`Move track ${p.title} to a folder`}
        className="press grid h-[26px] w-[26px] place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <FolderInput size={13} />
      </button>
      <Popover
        open={open}
        anchorRef={btnRef}
        onClose={() => setOpen(false)}
        width={200}
      >
        {/* Portal events bubble through the React tree — stop them so a menu
            click can't also open the tile's track. */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="rounded border border-line bg-panel py-1 shadow-lg shadow-black/40"
        >
          <p className="px-2.5 pb-1 pt-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
            Move to
          </p>
          {row(null, 'Library (no folder)')}
          {folders.map((f) => row(f.id, f.name))}
        </div>
      </Popover>
    </>
  )
}
