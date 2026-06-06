import { useMemo, useRef, useState } from 'react'
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
import type { Folder, Project } from '../types'
import { formatRelativeTime } from '../lib/format'
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

/**
 * The home page: the signed-in landing view listing every track as a tile,
 * grouped into flat folders (Drive semantics — the root shows folder tiles
 * plus the tracks that live outside any folder; clicking a folder drills in).
 * Tracks move between folders by drag-and-drop onto a folder tile (or the
 * Library crumb to unfile) and through each tile's "move to" menu. All data
 * mutations live in App; this component owns only ephemeral UI state.
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
  const [query, setQuery] = useState('')
  // Folder tile currently in inline-rename mode (a fresh folder starts there).
  const [renamingId, setRenamingId] = useState<string | null>(null)
  // The Library crumb lights up while a dragged track may be dropped on it.
  const [crumbOver, setCrumbOver] = useState(false)

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

  const counts = useMemo(() => {
    const m = new Map<string | null, number>()
    for (const p of projects) {
      const k = p.folderId && folderIds.has(p.folderId) ? p.folderId : null
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [projects, folderIds])

  const empty = projects.length === 0 && folders.length === 0

  return (
    <main className="flex min-h-0 min-w-0 flex-1 animate-fade-in flex-col">
      {/* Sub-bar: breadcrumbs + search + create actions (mirrors the editor's). */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-ink/60 px-3">
        {openFolder ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
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
            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold tracking-wide text-fg">
              <FolderIcon size={13} className="shrink-0 text-accentink/70" />
              {openFolder.name}
            </span>
          </div>
        ) : (
          <span className="flex-1 truncate px-1 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Library
          </span>
        )}

        {!empty && (
          <div className="relative shrink-0">
            <Search
              size={13}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Search tracks…"
              aria-label="Search all tracks"
              className="w-36 rounded border border-line bg-inset py-1 pl-7 pr-6 text-sm text-fg outline-none transition-colors placeholder:text-muted/70 focus:border-accent min-[720px]:w-60"
            />
            {searching && (
              <button
                type="button"
                onClick={() => setQuery('')}
                title="Clear search"
                aria-label="Clear search"
                className="press absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-fg"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
        {!openFolder && (
          <button
            type="button"
            onClick={() => setRenamingId(onCreateFolder())}
            className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line bg-raised px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-fg hover:border-accent hover:text-accentink"
          >
            <FolderPlus size={13} />
            <span className="hidden sm:inline">New folder</span>
          </button>
        )}
        <button
          type="button"
          onClick={onCreateTrack}
          className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-accentink hover:bg-accent/20"
        >
          <Plus size={13} />
          <span className="hidden sm:inline">New track</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {empty ? (
          /* First run: nothing at all yet — the old editor empty state's hero. */
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
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
              className="press inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-accentink hover:bg-accent/20"
            >
              <Plus size={14} /> New track
            </button>
          </div>
        ) : (
          <>
            {/* Folder tiles — root only, and hidden while a search is on. */}
            {!searching && !openFolder && folders.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                  Folders
                </h2>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                  {folders.map((f) => (
                    <FolderTile
                      key={f.id}
                      folder={f}
                      count={counts.get(f.id) ?? 0}
                      renaming={renamingId === f.id}
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
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                {searching
                  ? `Results — ${visible.length}`
                  : openFolder
                    ? `Tracks — ${visible.length}`
                    : 'Tracks'}
              </h2>
              {visible.length === 0 ? (
                searching ? (
                  <p className="py-6 text-sm text-muted">
                    No tracks match “{query.trim()}”.
                  </p>
                ) : openFolder ? (
                  <div className="flex flex-col items-center gap-3 border border-dashed border-line py-12 text-center">
                    <FolderIcon size={22} className="text-muted/50" />
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                      Nothing in this folder yet
                    </p>
                    <p className="max-w-xs text-[12px] leading-relaxed text-muted/70">
                      Create a track here, or go back to the library and drag
                      tracks onto this folder.
                    </p>
                    <button
                      type="button"
                      onClick={onCreateTrack}
                      className="press inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-accentink hover:bg-accent/20"
                    >
                      <Plus size={13} /> New track
                    </button>
                  </div>
                ) : (
                  <p className="py-4 text-sm text-muted">
                    No tracks outside folders.
                  </p>
                )
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {visible.map((p) => (
                    <TrackTile
                      key={p.id}
                      project={p}
                      folders={folders}
                      // Search results span folders — label each with its home.
                      folderName={
                        searching
                          ? folders.find((f) => f.id === folderOf(p))?.name ??
                            null
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
          </>
        )}
      </div>
    </main>
  )
}

/* ---- folder tile --------------------------------------------------------- */

function FolderTile({
  folder,
  count,
  renaming,
  onOpen,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
  onDropTrack,
}: {
  folder: Folder
  count: number
  renaming: boolean
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
      className={`group flex cursor-pointer items-center gap-2.5 rounded border p-3 transition-colors ${
        over
          ? 'border-accent bg-accent/10'
          : 'border-line bg-panel hover:border-line-strong'
      }`}
    >
      <FolderIcon size={16} className="shrink-0 text-accentink/70" />
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
            className="block w-full truncate text-left text-sm font-semibold tracking-wide text-fg"
          >
            {folder.name}
          </button>
        )}
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
          {count} {count === 1 ? 'track' : 'tracks'}
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
            className="press rounded p-1 text-muted hover:bg-raised hover:text-fg"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              // Deleting never deletes tracks — they fall back to the library.
              if (
                count === 0 ||
                confirm(
                  `Delete folder “${folder.name}”? Its ${count} ${
                    count === 1 ? 'track moves' : 'tracks move'
                  } back to the library.`,
                )
              )
                onDelete()
            }}
            title="Delete folder (its tracks move back to the library)"
            aria-label={`Delete folder ${folder.name}`}
            className="press rounded p-1 text-muted hover:bg-raised hover:text-danger"
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
  folders,
  folderName,
  onOpen,
  onDelete,
  onMove,
}: {
  project: Project
  folders: Folder[]
  /** Shown as a chip on cross-folder search results (null hides it). */
  folderName: string | null
  onOpen: () => void
  onDelete: () => void
  onMove: (folderId: string | null) => void
}) {
  const n = p.annotations.length
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TRACK_MIME, p.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      className="group flex cursor-pointer flex-col gap-2 rounded border border-line bg-panel p-3 transition-colors hover:border-line-strong"
    >
      <div className="flex items-start gap-2">
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
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold tracking-wide text-fg"
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
            className="press rounded p-1 text-muted hover:bg-raised hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-muted">
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
        className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs transition-colors ${
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
        className="press rounded p-1 text-muted hover:bg-raised hover:text-fg"
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
          <p className="px-2.5 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
            Move to
          </p>
          {row(null, 'Library (no folder)')}
          {folders.map((f) => row(f.id, f.name))}
        </div>
      </Popover>
    </>
  )
}
