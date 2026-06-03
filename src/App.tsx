import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Annotation, PlayerHandle, Project } from './types'
import {
  loadPlayerWidth,
  savePlayerWidth,
  DEFAULT_PLAYER_WIDTH,
  loadViewOnly,
  saveViewOnly,
  loadSidebarOpen,
  saveSidebarOpen,
} from './lib/storage'
import { fetchProjects, saveProject, deleteProjectDoc } from './lib/projectStore'
import { deleteAudio } from './lib/audioStore'
import { uploadAudio, deleteAudioCloud } from './lib/audioCloud'
import {
  uploadNoteImage,
  deleteProjectImages,
  reconcileProjectImages,
} from './lib/imageCloud'
import { parseVideoId } from './lib/youtube'
import { formatTime, noteLabel } from './lib/format'
import { colorForId } from './lib/noteColors'
import {
  Plus,
  Trash2,
  Menu,
  ChevronsLeft,
  Keyboard,
  LogOut,
  Eye,
  Pencil,
} from 'lucide-react'
import { useAuth } from './lib/auth'
import { usePresence } from './lib/usePresence'
import PlayerPane from './components/PlayerPane'
import Transport from './components/Transport'
import SourcePicker from './components/SourcePicker'
import AnnotationList from './components/AnnotationList'
import SharePanel from './components/SharePanel'
import ShortcutsOverlay from './components/ShortcutsOverlay'
import { useHotkeys } from './lib/useHotkeys'

const uid = () => crypto.randomUUID()
const now = () => Date.now()

export default function App() {
  const { user, signOut } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)

  // Last version of each project written to Firestore, keyed by id. Used to
  // write only the projects that actually changed (mutations replace the
  // changed project's object, so reference inequality means "dirty").
  const persistedRef = useRef<Map<string, Project>>(new Map())
  const hydratedRef = useRef(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // Playback speed, applied by the players themselves (prop-driven). Sticky
  // across tracks — a chosen analysis speed (e.g. 0.75×) carries over.
  const [playbackRate, setPlaybackRate] = useState(1)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [needsAudioFile, setNeedsAudioFile] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen)
  const [pendingIn, setPendingIn] = useState<number | null>(null)
  const [notesPad, setNotesPad] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  const [playerWidth, setPlayerWidth] = useState(loadPlayerWidth)
  const [draggingSplit, setDraggingSplit] = useState(false)
  const [viewOnly, setViewOnly] = useState(loadViewOnly)

  function setViewMode(view: boolean) {
    saveViewOnly(view)
    setViewOnly(view)
  }
  function toggleViewOnly() {
    setViewOnly((on) => {
      const next = !on
      saveViewOnly(next)
      return next
    })
  }

  // Remember the track rack open/closed across sessions. An effect (rather than
  // saving at each toggle site) keeps every setSidebarOpen caller in sync.
  useEffect(() => {
    saveSidebarOpen(sidebarOpen)
  }, [sidebarOpen])

  const playerRef = useRef<PlayerHandle>(null)
  const splitRef = useRef<HTMLDivElement>(null)
  const audioUrlRef = useRef<string | null>(null)
  const notesRoRef = useRef<ResizeObserver | null>(null)
  const notesScrollRef = useRef<HTMLDivElement | null>(null)
  // Projects whose orphaned images have already been swept this session.
  const sweptImagesRef = useRef<Set<string>>(new Set())

  // Pad the bottom of the notes panel so the playing note can scroll to the top
  // even when the notes don't fill the panel.
  const setNotesScroll = useCallback((el: HTMLDivElement | null) => {
    notesScrollRef.current = el
    notesRoRef.current?.disconnect()
    if (!el) return
    const update = () => setNotesPad(Math.max(0, el.clientHeight - 64))
    update()
    notesRoRef.current = new ResizeObserver(update)
    notesRoRef.current.observe(el)
  }, [])

  const current = projects.find((p) => p.id === currentId) ?? null

  // Keep the help modal mounted through its fade-out.
  const help = usePresence(showHelp)

  // Latest notes of the current project, read by the mention suggestion.
  const annotationsRef = useRef<Annotation[]>([])
  annotationsRef.current = current?.annotations ?? []

  // Stable callbacks so the players aren't torn down on every time tick.
  const handleTime = useCallback((t: number) => setCurrentTime(t), [])
  const handleDuration = useCallback((d: number) => setDuration(d), [])
  const handlePlaying = useCallback((p: boolean) => setIsPlaying(p), [])

  // Notes available to @-mention, filtered by the typed query.
  const getMentionItems = useCallback((query: string) => {
    const q = query.trim().toLowerCase()
    return annotationsRef.current
      .map((a) => ({
        id: a.id,
        label: noteLabel(a.start, a.end),
        color: a.color ?? colorForId(a.id),
        tag: a.tag,
      }))
      .filter(
        (it) =>
          !q ||
          it.label.toLowerCase().includes(q) ||
          (it.tag ?? '').includes(q),
      )
  }, [])

  // Upload a pasted/inserted note image to Cloud Storage (scoped to this user
  // and the open project) and resolve with its download URL for inlining in the
  // note HTML. Rejecting leaves the editor to fall back to an inline data URL.
  const handleUploadImage = useCallback(
    (blob: Blob, onProgress?: (fraction: number) => void): Promise<string> => {
      if (!user || !currentId)
        return Promise.reject(new Error('No active project for the image'))
      return uploadNoteImage(user.uid, currentId, blob, onProgress)
    },
    [user, currentId],
  )

  // Load this user's projects from Firestore once on sign-in.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadingProjects(true)
    hydratedRef.current = false
    fetchProjects(user.uid)
      .then((loaded) => {
        if (cancelled) return
        setProjects(loaded)
        persistedRef.current = new Map(loaded.map((p) => [p.id, p]))
        setCurrentId((cur) => cur ?? loaded[0]?.id ?? null)
        hydratedRef.current = true
        setLoadingProjects(false)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to load projects:', err)
        setLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  // Persist changed projects (debounced — TipTap fires onUpdate on every
  // keystroke). Only projects whose object reference changed are written.
  useEffect(() => {
    if (!hydratedRef.current || !user) return
    const uid = user.uid
    const t = setTimeout(() => {
      for (const p of projects) {
        if (persistedRef.current.get(p.id) !== p) {
          persistedRef.current.set(p.id, p)
          saveProject(uid, p).catch((err) =>
            console.error('Failed to save project:', err),
          )
        }
      }
    }, 400)
    return () => clearTimeout(t)
  }, [projects, user])

  // Load the audio for the selected project (streamed from Cloud Storage).
  useEffect(() => {
    setNeedsAudioFile(false)
    setPendingIn(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current)
      audioUrlRef.current = null
    }
    setAudioUrl(null)

    if (!current || current.source?.type !== 'audio') return

    // The audio streams straight from its Cloud Storage download URL (wavesurfer
    // fetches it). No object URL to revoke in this case.
    if (current.source.audioUrl) {
      setAudioUrl(current.source.audioUrl)
    } else {
      setNeedsAudioFile(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId])

  // Garbage-collect orphaned note images the first time a project is opened this
  // session. Reconciling against the just-loaded (persisted) note HTML keeps it
  // safe from editor undo — an image is only deleted once it's truly gone from
  // the saved notes. Runs in the background; failures are non-fatal.
  useEffect(() => {
    if (!user || !current) return
    if (sweptImagesRef.current.has(current.id)) return
    sweptImagesRef.current.add(current.id)
    const html = current.annotations.map((a) => a.contentHtml)
    reconcileProjectImages(user.uid, current.id, html)
      .then((n) => {
        if (n) console.info(`Swept ${n} orphaned image(s) from this project.`)
      })
      .catch((err) => console.error('Image cleanup failed:', err))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId, user])

  // ---- project mutations -------------------------------------------------
  const patchProject = useCallback((id: string, patch: Partial<Project>) => {
    setProjects((ps) =>
      ps.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now() } : p)),
    )
  }, [])

  function createProject() {
    const p: Project = {
      id: uid(),
      title: 'Untitled track',
      annotations: [],
      updatedAt: now(),
    }
    setProjects((ps) => [p, ...ps])
    setCurrentId(p.id)
  }

  function removeProject(id: string) {
    void deleteAudio(id) // legacy local copy, if any
    if (user) {
      void deleteAudioCloud(user.uid, id).catch((err) =>
        console.error('Failed to delete cloud audio:', err),
      )
      void deleteProjectImages(user.uid, id).catch((err) =>
        console.error('Failed to delete cloud images:', err),
      )
    }
    void deleteProjectDoc(id).catch((err) =>
      console.error('Failed to delete project:', err),
    )
    persistedRef.current.delete(id)
    const remaining = projects.filter((p) => p.id !== id)
    setProjects(remaining)
    if (currentId === id) setCurrentId(remaining[0]?.id ?? null)
  }

  function setYoutubeSource(url: string) {
    if (!current) return
    const videoId = parseVideoId(url)
    if (!videoId) {
      alert("Couldn't find a YouTube video id in that link.")
      return
    }
    patchProject(current.id, {
      source: { type: 'youtube', youtubeUrl: url, videoId },
    })
  }

  async function attachAudioFile(file: File) {
    if (!current || !user) return
    const projectId = current.id
    const startTitle = current.title

    // Play the local file immediately while the upload runs in the background.
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const localUrl = URL.createObjectURL(file)
    audioUrlRef.current = localUrl
    setAudioUrl(localUrl)
    setNeedsAudioFile(false)
    setUploadPct(0)

    // Switch to the player view right away (with local playback) so the upload
    // progress bar is visible. The audioUrl gets filled in once the upload ends.
    patchProject(projectId, {
      source: { type: 'audio', fileName: file.name },
      title:
        startTitle === 'Untitled track'
          ? file.name.replace(/\.[^.]+$/, '')
          : startTitle,
    })

    try {
      const url = await uploadAudio(user.uid, projectId, file, setUploadPct)
      patchProject(projectId, {
        source: { type: 'audio', fileName: file.name, audioUrl: url },
      })
    } catch (err) {
      console.error('Audio upload failed:', err)
      alert('Audio upload failed — check your connection and try again.')
    } finally {
      setUploadPct(null)
    }
  }

  // ---- annotation mutations ---------------------------------------------
  function addAnnotationAtCurrent() {
    if (!current) return
    const t = playerRef.current?.getCurrentTime?.() ?? currentTime
    const ann: Annotation = {
      id: uid(),
      start: Math.max(0, Math.floor(t)),
      contentHtml: '',
      createdAt: now(),
    }
    patchProject(current.id, { annotations: [...current.annotations, ann] })
  }

  function updateAnnotation(annId: string, patch: Partial<Annotation>) {
    if (!current) return
    patchProject(current.id, {
      annotations: current.annotations.map((a) =>
        a.id === annId ? { ...a, ...patch } : a,
      ),
    })
  }

  function deleteAnnotation(annId: string) {
    if (!current) return
    patchProject(current.id, {
      annotations: current.annotations.filter((a) => a.id !== annId),
    })
  }

  function seek(t: number) {
    playerRef.current?.seekTo(t)
    setCurrentTime(t)
  }

  // Optimistic transport: flip the playing state immediately so Play/Pause
  // feels instant, then let the player's own state-change events
  // (handlePlaying) reconcile — e.g. snap back to paused if playback never
  // actually started. Without this the YouTube iframe takes ~0.5s (buffering)
  // to report "playing", which makes the button feel sticky. Audio reports
  // instantly, so this just matches that responsiveness everywhere.
  function play() {
    setIsPlaying(true)
    playerRef.current?.play()
  }
  function pause() {
    setIsPlaying(false)
    playerRef.current?.pause()
  }

  // Jump to a mentioned note: seek to it and scroll it into view.
  function seekToNote(id: string) {
    const a = annotationsRef.current.find((x) => x.id === id)
    if (!a) return
    seek(a.start)
    document
      .getElementById(`note-${id}`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  // ---- range / waveform-region handlers ---------------------------------
  function createRange(id: string, start: number, end: number) {
    if (!current) return
    const s = Math.max(0, Math.round(Math.min(start, end)))
    const e = Math.max(Math.round(Math.max(start, end)), s + 1)
    patchProject(current.id, {
      annotations: [
        ...current.annotations,
        { id, start: s, end: e, contentHtml: '', createdAt: now() },
      ],
    })
  }

  function updateRegionGeom(id: string, start: number, end: number) {
    if (!current) return
    const a = current.annotations.find((x) => x.id === id)
    if (!a) return
    const patch =
      a.end == null
        ? { start: Math.max(0, Math.round(start)) }
        : {
            start: Math.max(0, Math.round(Math.min(start, end))),
            end: Math.round(Math.max(start, end)),
          }
    updateAnnotation(id, patch)
  }

  function markIn() {
    const t = playerRef.current?.getCurrentTime?.() ?? currentTime
    setPendingIn((prev) =>
      prev != null && Math.abs(prev - t) < 0.4 ? null : Math.max(0, t),
    )
  }

  function markOut() {
    if (pendingIn == null) return
    const t = playerRef.current?.getCurrentTime?.() ?? currentTime
    createRange(uid(), pendingIn, t)
    setPendingIn(null)
  }

  // Seek to the note before/after the playhead (and scroll it into view).
  function jumpNote(dir: 1 | -1) {
    if (!current || current.annotations.length === 0) return
    const sorted = [...current.annotations].sort((a, b) => a.start - b.start)
    const eps = 0.3
    const target =
      dir === 1
        ? sorted.find((a) => a.start > currentTime + eps)
        : [...sorted].reverse().find((a) => a.start < currentTime - eps)
    if (target) seekToNote(target.id)
  }

  // ---- global keyboard shortcuts (press ? for the full list) -------------
  const playerActive = !!current?.source && !needsAudioFile
  useHotkeys((e) => {
    // Always available: help overlay + sidebar.
    if (e.key === 'Escape') {
      if (showHelp) setShowHelp(false)
      return
    }
    if (e.key === '?') {
      e.preventDefault()
      setShowHelp((s) => !s)
      return
    }
    if (showHelp) return // modal open — swallow the rest
    if (e.key === '[') {
      e.preventDefault()
      setSidebarOpen((s) => !s)
      return
    }
    if (e.key === 'v' || e.key === 'V') {
      toggleViewOnly()
      return
    }

    // Below here needs a loaded player.
    if (!playerActive) return
    switch (e.key) {
      case ' ':
        e.preventDefault()
        if (isPlaying) pause()
        else play()
        break
      case 'ArrowLeft':
        e.preventDefault()
        seek(Math.max(0, currentTime - (e.shiftKey ? 30 : 5)))
        break
      case 'ArrowRight':
        e.preventDefault()
        seek(currentTime + (e.shiftKey ? 30 : 5))
        break
      case 'ArrowUp':
        e.preventDefault()
        jumpNote(-1)
        break
      case 'ArrowDown':
        e.preventDefault()
        jumpNote(1)
        break
      case 'Home':
        e.preventDefault()
        seek(0)
        break
      case 'End':
        e.preventDefault()
        if (duration > 0) seek(duration)
        break
      case 'n':
      case 'N':
        if (!viewOnly) addAnnotationAtCurrent()
        break
      case 'i':
      case 'I':
        if (!viewOnly) markIn()
        break
      case 'o':
      case 'O':
        if (!viewOnly) markOut()
        break
    }
  })

  // ---- resizable player|notes split -------------------------------------
  // Width is clamped in CSS (min-w / max-w on the pane) so it stays valid on
  // window resize; the JS clamp here just mirrors that range while dragging.
  function startSplitDrag(e: React.PointerEvent) {
    e.preventDefault()
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    let last = playerWidth
    setDraggingSplit(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent) => {
      const max = Math.max(360, rect.width - 340)
      last = Math.min(max, Math.max(360, ev.clientX - rect.left))
      setPlayerWidth(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDraggingSplit(false)
      savePlayerWidth(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function resetSplit() {
    setPlayerWidth(DEFAULT_PLAYER_WIDTH)
    savePlayerWidth(DEFAULT_PLAYER_WIDTH)
  }

  // The player|notes split goes side-by-side once its container is wide enough.
  // Usable space depends on the sidebar: open it eats 240px, so we require a
  // 900px viewport; collapsed we only need 660px (240px less) for the same fit.
  // Arbitrary min-[…] variants (full literals, no string concat) so Tailwind's
  // scanner generates both — and they need no tailwind.config screens.
  const splitVariant = sidebarOpen
    ? {
        row: 'min-[900px]:flex-row',
        pane: 'min-[900px]:w-[var(--player-w)] min-[900px]:min-w-[360px] min-[900px]:max-w-[calc(100%-340px)] min-[900px]:border-b-0',
        handle: 'min-[900px]:block',
      }
    : {
        row: 'min-[660px]:flex-row',
        pane: 'min-[660px]:w-[var(--player-w)] min-[660px]:min-w-[360px] min-[660px]:max-w-[calc(100%-340px)] min-[660px]:border-b-0',
        handle: 'min-[660px]:block',
      }

  const regionSpecs = current
    ? current.annotations.map((a) => ({
        id: a.id,
        start: a.start,
        end: a.end,
        color: colorForId(a.id),
      }))
    : []

  if (loadingProjects) {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-3 bg-ink text-muted">
        <span className="animate-now-pulse text-2xl text-accent">◉</span>
        <span className="font-mono text-xs uppercase tracking-[0.2em]">
          Loading your tracks…
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-ink text-fg">
      {/* ---- Global header ---- */}
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <span className="text-accent">◉</span>
        <span className="text-xs font-semibold uppercase tracking-[0.22em] text-fg">
          Sound&nbsp;Annotator
        </span>
        {viewOnly && (
          <span className="flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
            <Eye size={11} /> View only
          </span>
        )}
        <div className="flex-1" />
        {/* Mode toggle: a squared segmented switch (Edit | View). Tonal active
            fill keeps amber pure; the active View segment carries amber text to
            echo the view-only state. The 'V' key still flips it. */}
        <div
          role="group"
          aria-label="Editing mode"
          className="flex items-center gap-px rounded-sm border border-line bg-inset p-px"
        >
          <button
            type="button"
            onClick={() => setViewMode(false)}
            aria-pressed={!viewOnly}
            title="Edit mode (V)"
            className={`press flex items-center gap-1 rounded-[1px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors duration-150 ${
              viewOnly ? 'text-muted hover:text-fg' : 'bg-raised text-fg'
            }`}
          >
            <Pencil size={12} /> Edit
          </button>
          <button
            type="button"
            onClick={() => setViewMode(true)}
            aria-pressed={viewOnly}
            title="View-only mode (V)"
            className={`press flex items-center gap-1 rounded-[1px] px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors duration-150 ${
              viewOnly ? 'bg-raised text-accent' : 'text-muted hover:text-fg'
            }`}
          >
            <Eye size={12} /> View
          </button>
        </div>
        <button
          onClick={() => setShowHelp(true)}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          className="press rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
        >
          <Keyboard size={16} />
        </button>
        <LevelMeter active={isPlaying} />
        <div className="ml-1 flex items-baseline gap-1 rounded border border-line bg-inset px-2.5 py-1">
          <span className="led text-base leading-none">{formatTime(currentTime)}</span>
          <span className="font-mono text-[10px] text-muted">
            / {formatTime(duration)}
          </span>
        </div>

        {user && (
          <div className="ml-1 flex items-center gap-1.5 border-l border-line pl-3">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="h-6 w-6 rounded-full border border-line"
              />
            ) : (
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line bg-raised text-[11px] font-semibold uppercase text-muted">
                {(user.displayName ?? user.email ?? '?').slice(0, 1)}
              </span>
            )}
            <button
              onClick={() => void signOut()}
              title={`Sign out${user.email ? ` (${user.email})` : ''}`}
              aria-label="Sign out"
              className="press rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
            >
              <LogOut size={15} />
            </button>
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ---- Track rack (collapsible) ---- */}
        {/* Width-animates instead of mount-popping. Inner column keeps a fixed
            w-60 so its contents don't reflow as the rack closes; overflow-hidden
            clips them. Closed: inert + pointer-events-off so clipped controls
            stay out of the tab order. */}
        <aside
          inert={!sidebarOpen}
          className={`shrink-0 overflow-hidden border-r bg-panel transition-[width] duration-200 ease-instr ${
            sidebarOpen ? 'w-60 border-line' : 'w-0 border-transparent'
          }`}
        >
          <div className="flex h-full w-60 flex-col">
            {/* Same fixed height as the main sub-bar so their bottom borders align. */}
            <div className="flex h-11 items-center justify-between border-b border-line px-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                Tracks
              </span>
              <button
                onClick={() => setSidebarOpen(false)}
                title="Hide tracks ([)"
                aria-label="Hide track list"
                className="press rounded p-1 text-muted hover:bg-raised hover:text-fg"
              >
                <ChevronsLeft size={16} />
              </button>
            </div>
            {!viewOnly && (
              <div className="p-2">
                <button
                  onClick={createProject}
                  className="press inline-flex w-full items-center justify-center gap-1.5 rounded border border-line bg-raised px-3 py-2 text-xs font-semibold uppercase tracking-wider text-fg hover:border-accent hover:text-accent"
                >
                  <Plus size={14} /> New track
                </button>
              </div>
            )}
            <nav className="flex-1 overflow-y-auto pb-2">
              {projects.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted">
                  No tracks yet.
                </p>
              )}
              {projects.map((p) => {
                const isCurrent = p.id === currentId
                return (
                  <div
                    key={p.id}
                    className={`group flex items-center gap-1.5 border-b border-l-2 border-line/40 py-1.5 pl-2.5 pr-2 text-sm transition-colors duration-150 ease-instr ${
                      isCurrent
                        ? 'border-l-accent bg-raised text-fg'
                        : 'border-l-transparent text-muted hover:bg-raised/50 hover:text-fg'
                    }`}
                  >
                    <span className="font-mono text-xs text-accent/70">
                      {p.source?.type === 'youtube'
                        ? '▶'
                        : p.source?.type === 'audio'
                          ? '♪'
                          : '·'}
                    </span>
                    <button
                      onClick={() => setCurrentId(p.id)}
                      className="flex-1 truncate text-left"
                      title={p.title}
                    >
                      {p.title}
                    </button>
                    {!viewOnly && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete “${p.title}” and its notes?`))
                            removeProject(p.id)
                        }}
                        className="rounded px-1 text-muted opacity-0 hover:text-rose-400 group-hover:opacity-100"
                        title="Delete track"
                        aria-label={`Delete track ${p.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
            </nav>
            <div className="border-t border-line px-3 py-2 text-[10px] leading-snug text-muted">
              Synced to your account. Signed in across devices.
            </div>
          </div>
        </aside>

        {/* ---- Main ---- */}
        <main className="flex min-w-0 flex-1 flex-col">
          {/* Sub-bar: toggle + track title + source badge. Fixed height so the
              row doesn't grow/shrink as the sidebar toggle (only shown when the
              sidebar is collapsed) appears and disappears. */}
          <div className="flex h-11 items-center gap-2 border-b border-line bg-ink/60 px-3">
            {!sidebarOpen && (
              <button
                onClick={() => setSidebarOpen(true)}
                title="Show tracks ([)"
                aria-label="Show track list"
                className="press rounded p-1.5 text-muted hover:bg-raised hover:text-fg"
              >
                <Menu size={18} />
              </button>
            )}
            {current ? (
              <>
                {viewOnly ? (
                  <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold tracking-wide text-fg">
                    {current.title}
                  </span>
                ) : (
                  <input
                    value={current.title}
                    onChange={(e) =>
                      patchProject(current.id, { title: e.target.value })
                    }
                    aria-label="Track title"
                    className="min-w-0 flex-1 rounded-sm bg-transparent px-1 text-sm font-semibold tracking-wide text-fg"
                  />
                )}
                {current.source && (
                  <span className="shrink-0 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                    {current.source.type === 'youtube' ? '▶ YouTube' : '♪ Audio file'}
                  </span>
                )}
                {current.source && (
                  <SharePanel
                    project={current}
                    onToggleShare={(shared) =>
                      patchProject(current.id, { shared })
                    }
                  />
                )}
              </>
            ) : (
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
                No track selected
              </span>
            )}
          </div>

          {/* Body */}
          {!current ? (
            <div className="flex-1 animate-fade-in overflow-y-auto">
              <EmptyState onCreate={createProject} readOnly={viewOnly} />
            </div>
          ) : !current.source ? (
            <div className="flex-1 animate-fade-in overflow-y-auto px-6 py-6">
              {viewOnly ? (
                <ReadOnlyNotice>This track has no source yet.</ReadOnlyNotice>
              ) : (
                <SourcePicker
                  onYoutube={setYoutubeSource}
                  onAudioFile={attachAudioFile}
                />
              )}
            </div>
          ) : needsAudioFile ? (
            <div className="flex-1 animate-fade-in overflow-y-auto px-6 py-6">
              {viewOnly ? (
                <ReadOnlyNotice>
                  The audio for this track isn’t available right now
                  {current.source.fileName
                    ? ` (${current.source.fileName})`
                    : ''}
                  .
                </ReadOnlyNotice>
              ) : (
                <ReattachAudio
                  fileName={current.source.fileName}
                  onAudioFile={attachAudioFile}
                />
              )}
            </div>
          ) : (
            /* Two columns: resizable player on the left, notes scroll on the right */
            <div
              ref={splitRef}
              className={`flex min-h-0 flex-1 animate-fade-in flex-col ${splitVariant.row}`}
              style={{ ['--player-w' as string]: `${playerWidth}px` }}
            >
              {/* Viewer panel */}
              <div
                className={`flex shrink-0 flex-col overflow-y-auto border-b border-line ${splitVariant.pane}`}
              >
                <TitleBar
                  left="Player"
                  right={current.source.type === 'youtube' ? 'YouTube' : 'Audio'}
                />
                <div className="space-y-2.5 p-3">
                  <PlayerPane
                    ref={playerRef}
                    source={current.source}
                    audioUrl={audioUrl}
                    regionSpecs={regionSpecs}
                    playbackRate={playbackRate}
                    readOnly={viewOnly}
                    onTime={handleTime}
                    onDuration={handleDuration}
                    onPlayingChange={handlePlaying}
                    onSeek={seek}
                    onCreateRange={createRange}
                    onUpdateRegion={updateRegionGeom}
                  />

                  {uploadPct != null && (
                    <div className="flex items-center gap-2 border border-line bg-inset px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
                        <span
                          className="block h-full bg-accent transition-[width]"
                          style={{ width: `${Math.round(uploadPct * 100)}%` }}
                        />
                      </span>
                      Uploading {Math.round(uploadPct * 100)}%
                    </div>
                  )}

                  <Transport
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    duration={duration}
                    pendingIn={pendingIn}
                    playbackRate={playbackRate}
                    hasNotes={(current.annotations.length ?? 0) > 0}
                    readOnly={viewOnly}
                    onPlayPause={() => (isPlaying ? pause() : play())}
                    onSeek={seek}
                    onSetRate={setPlaybackRate}
                    onPrevNote={() => jumpNote(-1)}
                    onNextNote={() => jumpNote(1)}
                    onMarkIn={markIn}
                    onMarkOut={markOut}
                    onCancelMark={() => setPendingIn(null)}
                    onAddNote={addAnnotationAtCurrent}
                  />
                </div>
              </div>

              {/* Drag handle — resize the split (double-click to reset) */}
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize player and notes panels"
                onPointerDown={startSplitDrag}
                onDoubleClick={resetSplit}
                title="Drag to resize · double-click to reset"
                className={`hidden w-1 shrink-0 cursor-col-resize touch-none transition-colors ${splitVariant.handle} ${
                  draggingSplit ? 'bg-accent' : 'bg-line hover:bg-accent/60'
                }`}
              />

              {/* Notes panel */}
              <div className="flex min-w-0 flex-1 flex-col">
                <TitleBar
                  left="Notes"
                  right={`${current.annotations.length} ${
                    current.annotations.length === 1 ? 'note' : 'notes'
                  }`}
                />
                <div ref={setNotesScroll} className="relative flex-1 overflow-y-auto">
                  <AnnotationList
                    annotations={current.annotations}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    readOnly={viewOnly}
                    scrollRef={notesScrollRef}
                    onSeek={seek}
                    onPlay={play}
                    onUpdate={updateAnnotation}
                    onDelete={deleteAnnotation}
                    onSeekNote={seekToNote}
                    mentionItems={getMentionItems}
                    uploadImage={handleUploadImage}
                  />
                  {current.annotations.length > 0 && (
                    <div aria-hidden style={{ height: notesPad }} />
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {help.mounted && (
        <ShortcutsOverlay
          closing={help.closing}
          onClose={() => setShowHelp(false)}
        />
      )}
    </div>
  )
}

function LevelMeter({ active }: { active: boolean }) {
  const SEGS = 16
  return (
    <div
      className="bevel-inset flex h-4 items-stretch gap-[1.5px] border border-line bg-inset px-1 py-1"
      title="Output level"
      aria-hidden="true"
    >
      {Array.from({ length: SEGS }, (_, i) => {
        const color =
          i >= 14 ? '#ef6f6f' : i >= 11 ? 'rgb(var(--accent))' : 'rgb(var(--meter))'
        return (
          <span
            key={i}
            className={active ? 'meter-seg' : ''}
            style={{
              width: '2px',
              background: color,
              opacity: active ? undefined : i < 5 ? 0.55 : 0.1,
              animationDelay: active ? `${i * 45}ms` : undefined,
              animationDuration: active ? `${700 + (i % 5) * 90}ms` : undefined,
            }}
          />
        )
      })}
    </div>
  )
}

function TitleBar({ left, right }: { left: string; right?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line bg-raised/60 px-3 py-1.5">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
        {left}
      </span>
      {right && (
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          {right}
        </span>
      )}
    </div>
  )
}

function EmptyState({
  onCreate,
  readOnly,
}: {
  onCreate: () => void
  readOnly?: boolean
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="text-5xl">🎛️</div>
      <h2 className="text-lg font-semibold text-fg">
        {readOnly ? 'No tracks to view' : 'Annotate a piece of music'}
      </h2>
      <p className="max-w-sm text-sm text-muted">
        {readOnly
          ? 'There are no tracks here yet. Switch to edit mode to add one.'
          : 'Add a YouTube video or an audio file, then pin notes to any moment (or a whole section) with text, lists, and screenshots.'}
      </p>
      {!readOnly && (
        <button
          onClick={onCreate}
          className="press inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-accent hover:bg-accent/20"
        >
          <Plus size={14} /> New track
        </button>
      )}
    </div>
  )
}

function ReadOnlyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-line bg-inset p-6 text-center text-sm text-muted">
      {children}
    </div>
  )
}

function ReattachAudio({
  fileName,
  onAudioFile,
}: {
  fileName?: string
  onAudioFile: (file: File) => void
}) {
  const [over, setOver] = useState(false)
  const take = (file?: File | null) => {
    if (file && file.type.startsWith('audio/')) onAudioFile(file)
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        take(e.dataTransfer.files?.[0])
      }}
      className={`rounded border p-6 text-center ${
        over ? 'border-accent bg-accent/10' : 'border-accent/40 bg-accent/5'
      }`}
    >
      <p className="text-sm text-fg">
        The audio file{fileName ? ` (${fileName})` : ''} for this track isn't
        loaded. Re-open or drag it in to keep annotating. Your notes are safe.
      </p>
      <label className="mt-3 inline-flex cursor-pointer rounded border border-accent/70 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-accent hover:bg-accent/20">
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            take(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        Re-open audio file
      </label>
    </div>
  )
}
