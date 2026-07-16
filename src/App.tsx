import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { Annotation, Folder, PlayerHandle, Project } from './types'
import {
  loadInspectorWidth,
  saveInspectorWidth,
  loadVolume,
  saveVolume,
  DEFAULT_VOLUME,
  loadViewOnly,
  saveViewOnly,
  loadNoteOrder,
  saveNoteOrder,
  type NoteOrder,
  loadOverviewOpen,
  saveOverviewOpen,
  loadWindowMode,
  saveWindowMode,
} from './lib/storage'
import {
  fetchProjects,
  fetchSharedProject,
  saveProject,
  deleteProjectDoc,
} from './lib/projectStore'
import { useEditLock } from './lib/editLock'
import { fetchFolders, saveFolder, deleteFolderDoc } from './lib/folderStore'
import { deleteAudio } from './lib/audioStore'
import {
  uploadAudio,
  deleteAudioCloud,
  uploadAnalysisAudio,
  deleteAnalysisArtifacts,
} from './lib/audioCloud'
import {
  uploadNoteImage,
  deleteProjectImages,
  reconcileProjectImages,
} from './lib/imageCloud'
import { fetchVideoTitle, parseVideoId } from './lib/youtube'
import { copySharedProject } from './lib/copyProject'
import { makeTextBlock } from './lib/noteBlocks'
import {
  sectionsToAnnotations,
  AI_SECTION_PREFIX,
  type DetectedSection,
} from './lib/sectionDetect'
import { useMediaQuery } from './lib/useMediaQuery'
import { formatTime, noteLabel, notePreview } from './lib/format'
import { colorForId } from './lib/noteColors'
import { customTagsUsedIn, tagsOf } from './lib/tags'
import {
  ArrowLeft,
  LogOut,
  Eye,
  Pencil,
  Check,
  Play,
  Proportions,
  Settings as SettingsIcon,
  Undo2,
  Redo2,
} from 'lucide-react'
import { useAuth } from './lib/auth'
import { usePresence } from './lib/usePresence'
import { useTheme } from './lib/theme'
import ThemeToggle from './components/ThemeToggle'
import PlayerPane from './components/PlayerPane'
import Transport from './components/Transport'
import TrackOverview from './components/TrackOverview'
import NoteActions from './components/NoteActions'
import SourcePicker from './components/SourcePicker'
import DetectSectionsButton from './components/DetectSectionsButton'
import StemMixer from './components/StemMixer'
import AnnotationList from './components/AnnotationList'
import TitleBar from './components/TitleBar'
import NotesHeaderControls from './components/NotesHeaderControls'
import NotesSearch from './components/NotesSearch'
import SplitHandle from './components/SplitHandle'
import { useNotesView } from './lib/useNotesView'
import { usePassagePlayback } from './lib/usePassagePlayback'
import { useNotesSplit, NOTES_SPLIT_660 } from './lib/notesSplit'
import { computeFitLayout } from './lib/autoLayout'
import SharePanel from './components/SharePanel'
import HomePage from './components/HomePage'
import ExportPdfButton from './components/ExportPdfButton'
import SettingsModal from './components/SettingsModal'
import ShortcutsOverlay from './components/ShortcutsOverlay'
import PluginWindow, { type WindowMode } from './components/PluginWindow'
import NoteInspector from './components/NoteInspector'
import { useHotkeys, isTypingTarget } from './lib/useHotkeys'
import { useProjectHistory } from './lib/useProjectHistory'

const uid = () => crypto.randomUUID()
const now = () => Date.now()

// ---- URL <-> view ---------------------------------------------------------
// No router: `/` is the home page (the project library) and `?track={id}` is a
// deep link into the editor. Share links use `?view=` and never reach App —
// main.tsx routes them to the ShareViewer before this module matters.

/** The app URL for a given open track (or the home page when null). */
const trackUrl = (id: string | null) =>
  id ? `${window.location.pathname}?track=${id}` : window.location.pathname

/** Reflect a navigation in the URL (popstate drives the reverse direction). */
function syncUrl(id: string | null, mode: 'push' | 'replace' = 'push') {
  const url = trackUrl(id)
  if (url === window.location.pathname + window.location.search) return
  if (mode === 'push') window.history.pushState({ track: id }, '', url)
  else window.history.replaceState({ track: id }, '', url)
}

// How long consecutive ±step seeks keep accumulating against the same target
// before the next one re-anchors to the live playhead (see `step`).
const STEP_WINDOW = 1200

export default function App() {
  const { user, signOut } = useAuth()
  // Color theme controller (System / Light / Dark mode + signal palette).
  // Owns <html data-theme> and <html data-palette>.
  const {
    pref: themePref,
    setPref: setThemePref,
    resolved: resolvedTheme,
    palette,
    setPalette,
  } = useTheme()
  // Project data + the open-track id live behind an undo/redo history. `commit`
  // is the undoable mutation primitive; `setProjects` is raw (no history) for
  // hydration, text-body edits, and project lifecycle.
  const {
    projects,
    setProjects,
    currentId,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    epoch,
    reset: resetHistory,
  } = useProjectHistory()
  const [loadingProjects, setLoadingProjects] = useState(true)

  // Home-page folders. Outside the undo history (folder CRUD and track moves
  // are not undoable); persisted immediately via folderStore. `openFolderId`
  // lives here, not in HomePage, so the open folder survives a trip into the
  // editor and folder deletion can clear it in one place.
  const [folders, setFolders] = useState<Folder[]>([])
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)

  // Last version of each project persisted to the backend, keyed by id. Used to
  // write only the projects that actually changed (mutations replace the
  // changed project's object, so reference inequality means "dirty").
  const persistedRef = useRef<Map<string, Project>>(new Map())
  const hydratedRef = useRef(false)
  const [saveStatus, setSaveStatus] =
    useState<'idle' | 'editing' | 'saving' | 'saved' | 'error'>('idle')

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  // Playback speed, applied by the players themselves (prop-driven). Sticky
  // across tracks — a chosen analysis speed (e.g. 0.75×) carries over.
  const [playbackRate, setPlaybackRate] = useState(1)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [needsAudioFile, setNeedsAudioFile] = useState(false)
  const [uploadPct, setUploadPct] = useState<number | null>(null)
  // overviewOpen, playOnce, noteOrder are now derived below from project
  // settings (with the user-fallback states above as defaults).
  // Whether the notes search row is revealed (the query itself lives in
  // useNotesView). Resets when the track changes.
  const [searchOpen, setSearchOpen] = useState(false)
  const [pendingIn, setPendingIn] = useState<number | null>(null)
  // Id of a just-created note that should grab focus (and scroll into view) so
  // the user can start typing immediately. Cleared once the note handles it.
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null)
  const [notesPad, setNotesPad] = useState(0)
  const [showHelp, setShowHelp] = useState(false)
  // The resizable player|notes split (notes-fixed / player-flex; persisted).
  const {
    splitRef,
    dragging: draggingNotes,
    startSplitDrag,
    resetSplit,
    setNotesWidth,
    style: splitStyle,
  } = useNotesSplit()
  const [inspectorWidth, setInspectorWidth] = useState(loadInspectorWidth)
  // Dragging state for the inspector|notes handle (the player|notes handle owns
  // its own, inside `split`).
  const [draggingInspector, setDraggingInspector] = useState(false)
  // Player volume (0–1, sticky) and a separate mute that remembers the level.
  const [volume, setVolume] = useState(loadVolume)
  const [muted, setMuted] = useState(false)
  // While any stem is soloed the main player is silenced — the stems are the
  // sound, the player stays the clock (see StemMixer).
  const [stemActive, setStemActive] = useState(false)
  const [viewOnly, setViewOnly] = useState(loadViewOnly)
  // Settings modal — central knob for cross-cutting prefs. Each pref's effective
  // value is project.settings.X ?? user-local fallback (localStorage). Writes
  // go to both: the project (so it travels with the share) and localStorage
  // (so a brand-new project inherits the user's last choice as default).
  const [showSettings, setShowSettings] = useState(false)
  // Play-once defaults off; only a project's own settings can turn it on.
  const [userPlayOnce, setUserPlayOnce] = useState(false)
  const [userOverviewOpen, setUserOverviewOpen] = useState(loadOverviewOpen)
  const [userNoteOrder, setUserNoteOrder] = useState<NoteOrder>(loadNoteOrder)
  // Which note block (if any) is open in the plugin editor window, and how it's
  // presented. Below ~1100px the dock 3rd column won't fit → fall back to modal.
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [windowMode, setWindowMode] = useState<WindowMode>(loadWindowMode)
  const wideForDock = useMediaQuery('(min-width: 1100px)')

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
  // toggleOverview is defined below, after `current` is in scope (so the
  // toggle can also persist to project settings — see canEditSettings).
  // Reveal/dismiss the notes search row; closing always clears the query so the
  // list isn't left silently filtered with no visible field.
  function toggleSearch() {
    if (searchOpen) {
      setSearch('')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
    }
  }
  // Moving the slider always unmutes; dragging to 0 just goes silent.
  function changeVolume(v: number) {
    setVolume(v)
    if (v > 0) setMuted(false)
  }
  function toggleMute() {
    if (muted) {
      setMuted(false)
      // Unmuting from a zeroed slider would stay silent — restore a usable level.
      if (volume === 0) setVolume(DEFAULT_VOLUME)
    } else {
      setMuted(true)
    }
  }

  // Remember the chosen volume across sessions (mute is intentionally transient).
  useEffect(() => {
    saveVolume(volume)
  }, [volume])

  const playerRef = useRef<PlayerHandle>(null)
  // Wrap the player and overview so the resize drag + auto-fit can read their
  // live heights (their sum is the pool the vertical split divides).
  const playerBoxRef = useRef<HTMLDivElement>(null)
  const overviewRef = useRef<HTMLDivElement>(null)
  const audioUrlRef = useRef<string | null>(null)
  const notesRoRef = useRef<ResizeObserver | null>(null)
  const notesScrollRef = useRef<HTMLDivElement | null>(null)
  const playerAreaRoRef = useRef<ResizeObserver | null>(null)
  const playerMaxHRef = useRef(-1)
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

  // Drive --player-max-h from the player area's measured height so the 16:9 video
  // fills it (capped + centred) — the player now takes all the room the short
  // overview strip leaves. Guarded against re-applying so it can't loop.
  const setPlayerArea = useCallback((el: HTMLDivElement | null) => {
    playerAreaRoRef.current?.disconnect()
    if (!el) return
    const apply = () => {
      const h = el.clientHeight
      if (h > 0 && Math.abs(h - playerMaxHRef.current) >= 1) {
        playerMaxHRef.current = h
        el.style.setProperty('--player-max-h', `${h}px`)
      }
    }
    apply()
    playerAreaRoRef.current = new ResizeObserver(apply)
    playerAreaRoRef.current.observe(el)
  }, [])

  const current = projects.find((p) => p.id === currentId) ?? null

  // Home vs editor: no router — the home page is simply "no open track".
  // Deriving from `current` (not just currentId) self-heals a dangling id.
  const view: 'home' | 'track' = current ? 'track' : 'home'

  // Tab title follows the page: "{track} — Sound Annotator" in the editor
  // (kept live through renames — `current` is replaced on every edit), the
  // bare app name on the library. ShareViewer handles `?view=` links itself.
  useEffect(() => {
    document.title = current
      ? `${current.title || 'Untitled track'} — Sound Annotator`
      : 'Sound Annotator'
  }, [current])

  // Keep the help modal mounted through its fade-out.
  const help = usePresence(showHelp)

  // Latest notes of the current project, read by the mention suggestion.
  // Mirrored in an effect, not during render — both readers fire at event time.
  const annotationsRef = useRef<Annotation[]>([])
  useEffect(() => {
    annotationsRef.current = current?.annotations ?? []
  }, [current])

  // Latest project list for the popstate handler, which subscribes once and
  // fires outside React's data flow.
  const projectsRef = useRef<Project[]>([])
  useEffect(() => {
    projectsRef.current = projects
  }, [projects])

  // ---- edit lock (one session edits at a time) ---------------------------
  // A track open in the editor claims the project's edit lock (lib/editLock):
  // a second tab — or another user, via an editable share link — sees a
  // "being edited" banner and goes read-only instead of clobbering notes.
  const currentIdRef = useRef<string | null>(null)
  useEffect(() => {
    currentIdRef.current = currentId
  }, [currentId])

  // A "foreign" track came in through an editable share link: another
  // account owns it, so share/source/folder powers are off the table here.
  const isForeign =
    !!user && !!current?.ownerId && current.ownerId !== user.uid
  // The owner switched the link back to view-only while we were in it.
  const foreignRevoked = isForeign && current?.editableByLink !== true

  // While locked out, each server snapshot replaces our copy of the project,
  // so the read-only view tracks the live editor and a take-over starts from
  // their latest content. Re-baselining (not just setProjects) also empties
  // the undo stacks — a stale frame must not resurrect overwritten notes.
  const handleRemoteData = useCallback(
    (remote: Project) => {
      persistedRef.current.set(remote.id, remote)
      if (!projectsRef.current.some((p) => p.id === remote.id)) return
      resetHistory(
        projectsRef.current.map((p) => (p.id === remote.id ? remote : p)),
        currentIdRef.current,
      )
    },
    [resetHistory],
  )

  // View mode doesn't claim the lock: someone passively watching a track
  // (a projector, a quick look) must never block whoever wants to edit.
  // Flipping back to Edit re-engages — and only then surfaces the banner if
  // someone else holds it.
  const editLock = useEditLock({
    projectId: current?.id ?? null,
    user,
    enabled: !!current && !!user && !foreignRevoked && !viewOnly,
    onRemoteData: handleRemoteData,
  })
  const lockBlocked =
    editLock.state === 'other' || editLock.state === 'revoked' || foreignRevoked
  // Read-only for any reason: the user's own View toggle, or the lock.
  const effectiveViewOnly = viewOnly || lockBlocked

  // Settings live on the project; user-local values are the fallback when a
  // project has none. On opening a project that *has* settings, we sync the
  // user state from it (once per project id) so the UI reads from one source.
  // After that the user state is the live value: toggles update it directly,
  // and — when the user can save settings (owner, not locked) — also patch the
  // project doc so the choice travels with the share.
  const canEditSettings = !effectiveViewOnly && !isForeign && !!current
  const settingsSyncedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!current) {
      settingsSyncedFor.current = null
      return
    }
    if (settingsSyncedFor.current === current.id) return
    settingsSyncedFor.current = current.id
    const s = current.settings
    if (s?.playOnce !== undefined) setUserPlayOnce(s.playOnce)
    if (s?.overviewOpen !== undefined) setUserOverviewOpen(s.overviewOpen)
    if (s?.noteOrder !== undefined) setUserNoteOrder(s.noteOrder)
  }, [current])
  const playOnce = userPlayOnce
  const overviewOpen = userOverviewOpen
  const noteOrder = userNoteOrder
  const patchProjectSettings = useCallback(
    (patch: Partial<NonNullable<Project['settings']>>) => {
      if (!canEditSettings || !current) return
      const id = current.id
      setProjects((ps) =>
        ps.map((p) =>
          p.id === id
            ? {
                ...p,
                settings: { ...p.settings, ...patch },
                updatedAt: now(),
              }
            : p,
        ),
      )
    },
    [canEditSettings, current, setProjects],
  )
  const setPlayOnce = useCallback(
    (on: boolean) => {
      setUserPlayOnce(on)
      patchProjectSettings({ playOnce: on })
    },
    [patchProjectSettings],
  )
  const setOverviewOpenPref = useCallback(
    (on: boolean) => {
      setUserOverviewOpen(on)
      saveOverviewOpen(on)
      patchProjectSettings({ overviewOpen: on })
    },
    [patchProjectSettings],
  )
  const toggleOverview = useCallback(() => {
    setOverviewOpenPref(!overviewOpen)
  }, [overviewOpen, setOverviewOpenPref])
  const changeNoteOrder = useCallback(
    (mode: NoteOrder) => {
      setUserNoteOrder(mode)
      saveNoteOrder(mode)
      patchProjectSettings({ noteOrder: mode })
    },
    [patchProjectSettings],
  )
  // Mirrors for the debounced save (fires outside React's data flow, well
  // after the commit these effects ride on).
  const lockBlockedRef = useRef(false)
  const lockClaimRef = useRef(editLock.claim)
  useEffect(() => {
    lockBlockedRef.current = lockBlocked
    lockClaimRef.current = editLock.claim
  }, [lockBlocked, editLock.claim])
  // The lock holder's label; their own account in a second tab is the
  // commonest case, so call that out instead of showing them their own name.
  const lockHolderLabel =
    editLock.holder &&
    (user && editLock.holder.uid === user.uid
      ? 'Another tab'
      : editLock.holder.name)

  // Going read-only (View toggle or lock) deselects any open note, so nothing
  // stays highlighted/inspected. An effect (rather than clearing at each
  // toggle site) covers every path in: the View button, the V shortcut, a
  // saved state, and losing the edit lock.
  useEffect(() => {
    if (effectiveViewOnly) setSelectedNoteId(null)
  }, [effectiveViewOnly])

  // ---- note inspector (dock 3rd column or modal) ------------------------
  const effectiveWindowMode: WindowMode =
    windowMode === 'dock' && wideForDock ? 'dock' : 'modal'
  const selectedNote =
    selectedNoteId && current
      ? current.annotations.find((a) => a.id === selectedNoteId) ?? null
      : null
  // Custom tags already used in this project, offered for reuse in the picker.
  const projectTags = useMemo(
    () => customTagsUsedIn(current?.annotations ?? []),
    [current?.annotations],
  )
  // Notes-list view state (tag filter, order, auto-pin, auto-cue) — shared with
  // the read-only ShareViewer; none of it mutates notes.
  const {
    autoPin,
    autoSeek,
    setTagFilter,
    filterTags,
    filterTagCounts,
    activeFilter,
    search,
    setSearch,
    isFiltered,
    visibleAnnotations,
  } = useNotesView(current?.annotations ?? [], noteOrder)
  // The inspector is editing-only (never in view-only mode). In dock mode it's a
  // persistent 3rd column — open even with nothing selected (it shows an empty
  // state); the modal only appears on demand, when a note is actually selected.
  const showDock = !effectiveViewOnly && effectiveWindowMode === 'dock'
  const showModal =
    !effectiveViewOnly && !!selectedNote && effectiveWindowMode === 'modal'
  const transportLocked = showModal
  const inspectorSubtitle = selectedNote
    ? noteLabel(selectedNote.start, selectedNote.end)
    : undefined

  // Esc deselects the open note in the docked inspector (the modal inspector
  // closes on Esc via PluginWindow). A window listener so it fires even while
  // the caret is in the note editor — which the global hotkeys deliberately
  // skip — and it stands down for an open @-mention popup or the help overlay.
  useEffect(() => {
    if (!showDock || !selectedNoteId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (showHelp || document.querySelector('[data-mention-popup]')) return
      setSelectedNoteId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showDock, selectedNoteId, showHelp])

  // After a seek, the player keeps reporting its old position for a beat
  // (YouTube polls getCurrentTime; audio lags a frame), which would clobber the
  // optimistic time and flash back. Ignore reports until it reaches the target
  // (within 0.6s) or a short deadline passes.
  const seekGuardRef = useRef<{ target: number; deadline: number } | null>(null)

  // Relative ±step seeks (the 1s/5s buttons and ←/→) accumulate against a
  // short-lived target instead of the live, advancing playhead. Without this,
  // tapping "back 1s" while playing is eaten by the ≥1s that elapses between
  // presses, so slow taps never actually move back. After STEP_WINDOW of no
  // stepping, the next step re-anchors to the real playhead.
  const seekTargetRef = useRef<number | null>(null)
  const lastStepRef = useRef(0)

  // Stable callbacks so the players aren't torn down on every time tick.
  const handleTime = useCallback((t: number) => {
    const g = seekGuardRef.current
    if (g) {
      if (Math.abs(t - g.target) > 0.6 && now() < g.deadline) return
      seekGuardRef.current = null
    }
    setCurrentTime(t)
  }, [])
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
        tags: tagsOf(a),
        preview: notePreview(a.contentHtml),
      }))
      .filter(
        (it) =>
          !q ||
          it.label.toLowerCase().includes(q) ||
          it.tags.some((t) => t.toLowerCase().includes(q)) ||
          it.preview.toLowerCase().includes(q),
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

  // Load this user's projects and folders from the backend once on sign-in.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoadingProjects(true)
    hydratedRef.current = false
    Promise.all([
      fetchProjects(user.uid),
      // Folders are non-critical chrome: a failed read (offline blip, rules
      // not yet deployed) must never block the project list from loading.
      fetchFolders(user.uid).catch((err) => {
        console.error('Failed to load folders:', err)
        return [] as Folder[]
      }),
    ])
      .then(async ([loaded, loadedFolders]) => {
        if (cancelled) return
        setFolders(loadedFolders)
        // Land on the home page — unless the URL deep-links (`?track=`) to a
        // track we actually own; a dead link falls back home and is cleaned.
        const urlId = new URLSearchParams(window.location.search).get('track')
        // A deep link to a track we don't own may be an editable share link
        // ("Edit" from the viewer): fetch it and join it to the session list.
        // It stays out of the home library and is gone on the next sign-in.
        let all = loaded
        if (urlId && !loaded.some((p) => p.id === urlId)) {
          const foreign = await fetchSharedProject(urlId)
          if (cancelled) return
          if (foreign && foreign.editableByLink && foreign.ownerId !== user.uid)
            all = [...loaded, foreign]
        }
        const deepLink = urlId && all.some((p) => p.id === urlId) ? urlId : null
        if (urlId && !deepLink) syncUrl(null, 'replace')
        // Baseline the history to the freshly loaded set (clears any prior
        // undo/redo stacks); nothing before sign-in should be undoable.
        resetHistory(all, deepLink)
        persistedRef.current = new Map(all.map((p) => [p.id, p]))
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
  }, [user, resetHistory])

  // Back/forward: re-derive the open track from the URL. An id that no longer
  // exists (deleted track, stale entry) falls back to home and cleans the URL.
  useEffect(() => {
    const onPop = () => {
      const id = new URLSearchParams(window.location.search).get('track')
      const valid =
        id && projectsRef.current.some((p) => p.id === id) ? id : null
      if (id && !valid) syncUrl(null, 'replace')
      setSelectedNoteId(null)
      resetHistory(projectsRef.current, valid)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [resetHistory])

  // Persist changed projects (debounced — TipTap fires onUpdate on every
  // keystroke). Only projects whose object reference changed are written.
  // Drives the header save indicator: editing… → saving… → saved.
  useEffect(() => {
    if (!hydratedRef.current || !user) return
    const uid = user.uid
    const dirty = projects.filter((p) => persistedRef.current.get(p.id) !== p)
    if (dirty.length === 0) return
    setSaveStatus('editing')
    const t = setTimeout(() => {
      setSaveStatus('saving')
      // The open track is never flushed while another session holds its edit
      // lock (the rules would refuse the write anyway): any local stragglers
      // from just before the lock was lost are superseded by the remote
      // snapshots that re-baseline persistedRef.
      const flushable = dirty.filter(
        (p) => !(lockBlockedRef.current && p.id === currentIdRef.current),
      )
      Promise.all(
        flushable.map((p) => {
          persistedRef.current.set(p.id, p)
          // Saves of the open track carry this session's edit-lock claim:
          // it both proves we hold the lock (rules refuse content writes
          // without it) and refreshes the lock's heartbeat.
          return saveProject(
            uid,
            p,
            p.id === currentIdRef.current
              ? lockClaimRef.current ?? undefined
              : undefined,
          )
        }),
      )
        .then(() =>
          setSaveStatus(flushable.length < dirty.length ? 'idle' : 'saved'),
        )
        .catch((err) => {
          console.error('Failed to save project:', err)
          setSaveStatus('error')
        })
    }, 888)
    return () => clearTimeout(t)
  }, [projects, user])

  // Load the audio for the selected project (streamed from Cloud Storage).
  useEffect(() => {
    setNeedsAudioFile(false)
    setPendingIn(null)
    setCurrentTime(0)
    setDuration(0)
    setIsPlaying(false)
    setStemActive(false) // the mixer remounts per track (key), silent again
    setTagFilter(new Set())
    setSearch('')
    setSearchOpen(false)
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
    // Never sweep a foreign (link-edited) track: its images live under the
    // *owner's* Storage path, which we can't even list.
    if (current.ownerId && current.ownerId !== user.uid) return
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

  // Bring a just-created note's preview into view (the inspector focuses its
  // editor and clears the target). No state changes here — pure scroll.
  useEffect(() => {
    if (!focusNoteId) return
    const raf = requestAnimationFrame(() => {
      document
        .getElementById(`note-${focusNoteId}`)
        ?.scrollIntoView({ block: 'nearest' })
    })
    return () => cancelAnimationFrame(raf)
  }, [focusNoteId])

  // ---- project mutations -------------------------------------------------
  // Raw, non-undoable patch (text-body edits, audio attach, share toggle).
  const patchProject = useCallback(
    (id: string, patch: Partial<Project>) => {
      setProjects((ps) =>
        ps.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: now() } : p)),
      )
    },
    [setProjects],
  )

  // Undoable patch — same shape as patchProject, but recorded in history.
  const commitProject = useCallback(
    (id: string, patch: Partial<Project>, opts?: { coalesceKey?: string }) => {
      commit(
        (ps) =>
          ps.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: now() } : p,
          ),
        opts,
      )
    },
    [commit],
  )

  // Undoable mutation of one project's annotations. `fn` maps the latest
  // annotation list (read from the history's present, not a stale closure).
  const commitAnnotations = useCallback(
    (
      projectId: string,
      fn: (anns: Annotation[]) => Annotation[],
      opts?: { coalesceKey?: string },
    ) => {
      commit(
        (ps) =>
          ps.map((p) =>
            p.id === projectId
              ? { ...p, updatedAt: now(), annotations: fn(p.annotations) }
              : p,
          ),
        opts,
      )
    },
    [commit],
  )

  // ---- home / editor navigation ------------------------------------------
  // Opening and closing tracks are lifecycle boundaries (like create/delete):
  // both re-baseline the history, so undo can never switch tracks under the
  // URL, and both reflect themselves in it (popstate drives the reverse).
  function openTrack(id: string) {
    setSelectedNoteId(null)
    resetHistory(projects, id)
    syncUrl(id)
  }
  function goHome() {
    setSelectedNoteId(null)
    resetHistory(projects, null)
    syncUrl(null)
  }
  /** Back from the editor: home, landed inside the track's folder (root when
      it has none — or when its folderId is foreign/stale and we don't own it). */
  function goBack() {
    const folderId = current?.folderId ?? null
    setOpenFolderId(
      folderId && folders.some((f) => f.id === folderId) ? folderId : null,
    )
    goHome()
  }

  function createProject() {
    const p: Project = {
      id: uid(),
      title: 'Untitled track',
      annotations: [],
      updatedAt: now(),
      // Born into the folder that's open on the home page (null = root).
      folderId: openFolderId,
    }
    // Adding a track is a lifecycle boundary, not an undoable edit — re-baseline
    // so undo can't later cross it and silently drop the new track.
    resetHistory([p, ...projects], p.id)
    syncUrl(p.id)
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
      void deleteAnalysisArtifacts(user.uid, id).catch((err) =>
        console.error('Failed to delete analysis artifacts:', err),
      )
    }
    void deleteProjectDoc(id).catch((err) =>
      console.error('Failed to delete project:', err),
    )
    persistedRef.current.delete(id)
    const remaining = projects.filter((p) => p.id !== id)
    // Deleting a track tears down its cloud assets irreversibly — re-baseline
    // history so a later undo can't resurrect it into a broken state. Deleting
    // the open track lands back on the home page.
    resetHistory(remaining, currentId === id ? null : currentId)
    if (currentId === id) syncUrl(null, 'replace')
  }

  // ---- folders -------------------------------------------------------------
  // Folder CRUD is optimistic local state + an immediate fire-and-forget write
  // (matching removeProject's style); it never enters the undo history.
  function createFolder(): string {
    const f: Folder = { id: uid(), name: 'New folder', createdAt: now() }
    setFolders((fs) => [...fs, f])
    if (user)
      void saveFolder(user.uid, f).catch((err) =>
        console.error('Failed to create folder:', err),
      )
    return f.id // HomePage opens the fresh tile in rename mode
  }

  function renameFolder(id: string, name: string) {
    const next = name.trim()
    const f = folders.find((x) => x.id === id)
    if (!next || !f || next === f.name) return
    setFolders((fs) => fs.map((x) => (x.id === id ? { ...x, name: next } : x)))
    if (user)
      void saveFolder(user.uid, { ...f, name: next }).catch((err) =>
        console.error('Failed to rename folder:', err),
      )
  }

  function deleteFolder(id: string) {
    // Drive semantics: the folder's tracks move back to the root library, not
    // the trash. New object references → the dirty-save effect persists each.
    setProjects((ps) =>
      ps.map((p) => (p.folderId === id ? { ...p, folderId: null } : p)),
    )
    setFolders((fs) => fs.filter((f) => f.id !== id))
    if (openFolderId === id) setOpenFolderId(null)
    void deleteFolderDoc(id).catch((err) =>
      console.error('Failed to delete folder:', err),
    )
  }

  // Move a track between folders (null = unfiled). Raw, non-undoable: the
  // dirty-save effect picks up the new object reference and persists it.
  const moveTrackToFolder = useCallback(
    (id: string, folderId: string | null) => patchProject(id, { folderId }),
    [patchProject],
  )

  // Make a copy of a track from the home library. Clones to Storage, then
  // splices the saved copy into local state (no refetch needed). The home
  // page sorts by updatedAt, so the fresh copy lands first.
  const copyTrack = useCallback(
    async (project: Project) => {
      if (!user) return
      const copy = await copySharedProject(user.uid, project)
      persistedRef.current.set(copy.id, copy)
      setProjects((ps) => [copy, ...ps])
    },
    [user, setProjects],
  )

  // Turn on view-only sharing for a track without opening the editor — the
  // home-page "Share link" menu item flips the gate so the link works.
  const enableTrackShare = useCallback(
    (id: string) => patchProject(id, { shared: true }),
    [patchProject],
  )

  function setYoutubeSource(url: string) {
    if (!current) return
    const videoId = parseVideoId(url)
    if (!videoId) {
      alert("Couldn't find a YouTube video id in that link.")
      return
    }
    commitProject(current.id, {
      source: { type: 'youtube', youtubeUrl: url, videoId },
    })
    // Derive the initial title from the video (mirrors the audio-file path).
    // Re-checked at resolve time so a rename during the fetch wins; raw
    // (non-undoable) like the audio attach's title patch.
    if (current.title === 'Untitled track') {
      const projectId = current.id
      void fetchVideoTitle(videoId).then((title) => {
        if (!title) return
        setProjects((ps) =>
          ps.map((p) =>
            p.id === projectId && p.title === 'Untitled track'
              ? { ...p, title, updatedAt: now() }
              : p,
          ),
        )
      })
    }
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
      blocks: [makeTextBlock('')],
      createdAt: now(),
    }
    commitAnnotations(current.id, (anns) => [...anns, ann])
    selectNote(ann.id)
    setFocusNoteId(ann.id)
  }

  // Add a note at an explicit time (optional end → a range), then open it.
  function addNoteAt(start: number, end?: number) {
    if (!current) return
    const s = Math.max(0, Math.floor(start))
    const ann: Annotation = {
      id: uid(),
      start: s,
      contentHtml: '',
      blocks: [makeTextBlock('')],
      createdAt: now(),
    }
    if (end != null) ann.end = Math.max(Math.floor(end), s + 1)
    commitAnnotations(current.id, (anns) => [...anns, ann])
    selectNote(ann.id)
    setFocusNoteId(ann.id)
  }

  function updateAnnotation(
    annId: string,
    patch: Partial<Annotation>,
    opts?: { mode?: 'text'; coalesceKey?: string },
  ) {
    if (!current) return
    const projectId = current.id
    const fn = (anns: Annotation[]) =>
      anns.map((a) => (a.id === annId ? { ...a, ...patch } : a))
    if (opts?.mode === 'text') {
      // Rich-text body: editor owns its undo, so apply raw (no history step).
      // It still rides along in the next undoable snapshot.
      setProjects((ps) =>
        ps.map((p) =>
          p.id === projectId
            ? { ...p, updatedAt: now(), annotations: fn(p.annotations) }
            : p,
        ),
      )
    } else {
      commitAnnotations(
        projectId,
        fn,
        opts?.coalesceKey ? { coalesceKey: opts.coalesceKey } : undefined,
      )
    }
  }

  // Persist a manual order for a group of same-time notes: `orderedIds` is the
  // group in its new top-to-bottom order, and each gets `order` = its position.
  // Other notes are untouched (the order field only breaks same-`start` ties).
  function reorderAnnotations(orderedIds: string[]) {
    if (!current) return
    const pos = new Map(orderedIds.map((id, i) => [id, i]))
    commitAnnotations(current.id, (anns) =>
      anns.map((a) => (pos.has(a.id) ? { ...a, order: pos.get(a.id)! } : a)),
    )
  }

  function deleteAnnotation(annId: string) {
    if (!current) return
    if (selectedNoteId === annId) setSelectedNoteId(null)
    commitAnnotations(current.id, (anns) => anns.filter((a) => a.id !== annId))
  }

  function seek(t: number) {
    seekGuardRef.current = { target: t, deadline: now() + 800 }
    setCurrentTime(t)
    playerRef.current?.seekTo(t)
  }

  function step(delta: number) {
    const recent = now() - lastStepRef.current < STEP_WINDOW
    const base =
      recent && seekTargetRef.current != null
        ? seekTargetRef.current
        : playerRef.current?.getCurrentTime?.() ?? currentTime
    let target = base + delta
    if (duration > 0) target = Math.min(target, duration)
    target = Math.max(0, target)
    seekTargetRef.current = target
    lastStepRef.current = now()
    seek(target)
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

  // One-shot passage play (a range note's loop segment): seek to the note's
  // start, play, pause at its end.
  const { passageId, playPassage, cancelPassage } = usePassagePlayback({
    currentTime,
    seek,
    play,
    pause,
  })
  // An armed stop is positional — it means nothing on another track.
  useEffect(() => cancelPassage(), [currentId, cancelPassage])

  // ---- note inspector controls ------------------------------------------
  function selectNote(id: string, seekToo = false) {
    const note = current?.annotations.find((a) => a.id === id)
    // Clicking the already-open note deselects it (the persistent dock shows its
    // empty state; a modal closes) — unless this is an explicit ⌘/Ctrl-click,
    // which just re-cues the playhead without deselecting.
    if (id === selectedNoteId) {
      if (seekToo && note) seek(note.start)
      else setSelectedNoteId(null)
      return
    }
    setSelectedNoteId(id)
    // Cue the playhead to the note only when asked: a ⌘/Ctrl-click, or when the
    // order is Auto/Live (auto-cue rides the order switch). In Timeline, plain
    // clicks leave the playhead put so editing doesn't keep jumping the player
    // around. Never auto-plays.
    if ((seekToo || autoSeek) && note) seek(note.start)
    // A modal inspector covers the transport, so pause when it'll open as one.
    if (effectiveWindowMode === 'modal') pause()
  }
  function changeWindowMode(mode: WindowMode) {
    saveWindowMode(mode)
    setWindowMode(mode)
    // Switching to modal (or to dock where it can't fit) covers the transport.
    if (!(mode === 'dock' && wideForDock)) pause()
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
    commitAnnotations(current.id, (anns) => [
      ...anns,
      {
        id,
        start: s,
        end: e,
        contentHtml: '',
        blocks: [makeTextBlock('')],
        createdAt: now(),
      },
    ])
    selectNote(id)
    setFocusNoteId(id)
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
    // A drag fires many updates — collapse them into one undo step.
    updateAnnotation(id, patch, { coalesceKey: `region:${id}` })
  }

  // Apply AI-detected sections as structure notes — one undoable step that
  // also replaces any previous AI batch (re-detect refines, never duplicates).
  // The run's saved stems ride along raw (non-undoable): the server-side
  // analysis owns them, this just lets the mixer appear without a refetch.
  const applyDetectedSections = useCallback(
    (
      sections: DetectedSection[],
      _bpm?: number,
      stems?: Record<string, string>,
    ) => {
      const id = currentIdRef.current
      if (!id) return
      const fresh = sectionsToAnnotations(sections)
      commitAnnotations(id, (anns) => [
        ...anns.filter((a) => !a.id.startsWith(AI_SECTION_PREFIX)),
        ...fresh,
      ])
      if (stems && Object.keys(stems).length > 0) patchProject(id, { stems })
    },
    [commitAnnotations, patchProject],
  )

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
    if (view === 'home') return // home page: no transport/edit hotkeys
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
    if (transportLocked) return // a modal plugin window owns the keyboard
    if (e.key === 'v' || e.key === 'V') {
      // The View/Edit toggle is moot while the lock forces read-only.
      if (!lockBlocked) toggleViewOnly()
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
        step(-5)
        break
      case 'ArrowRight':
        e.preventDefault()
        step(5)
        break
      case 'ArrowUp':
        e.preventDefault()
        step(-1)
        break
      case 'ArrowDown':
        e.preventDefault()
        step(1)
        break
      case '[':
        e.preventDefault()
        jumpNote(-1)
        break
      case ']':
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
        if (!effectiveViewOnly) addAnnotationAtCurrent()
        break
      case 'i':
      case 'I':
        if (!effectiveViewOnly) markIn()
        break
      case 'o':
      case 'O':
        if (!effectiveViewOnly) markOut()
        break
    }
  })

  // ---- undo / redo -------------------------------------------------------
  // A dedicated listener (the global hotkeys deliberately ignore Cmd/Ctrl
  // combos). While the caret is in a text field — TipTap's contenteditable, an
  // input, etc. — we stand down so the editor/native undo handles it; otherwise
  // Cmd/Ctrl-Z undoes structural changes and Cmd-Shift-Z / Ctrl-Y redoes.
  useEffect(() => {
    // Editor-only (belt and braces on home: nav re-baselines, so canUndo is
    // already false there — the gate just makes the intent explicit).
    if (effectiveViewOnly || view === 'home') return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const k = e.key.toLowerCase()
      const isUndo = k === 'z' && !e.shiftKey
      const isRedo = (k === 'z' && e.shiftKey) || k === 'y'
      if (!isUndo && !isRedo) return
      if (e.defaultPrevented || isTypingTarget(e.target)) return
      e.preventDefault()
      if (isRedo) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [effectiveViewOnly, view, undo, redo])

  // ---- docked inspector (3rd column) resize -----------------------------
  // The player|notes split itself lives in `useNotesSplit` (shared with the
  // ShareViewer). Resize the docked inspector here: it hugs the right edge, so
  // its width grows as you drag the handle left; the player panel (the flex
  // column) takes the rest, leaving the notes column untouched.
  function startInspectorDrag(e: React.PointerEvent) {
    e.preventDefault()
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    let last = inspectorWidth
    setDraggingInspector(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const move = (ev: PointerEvent) => {
      const max = Math.max(280, rect.width - 360)
      last = Math.min(max, Math.max(280, rect.right - ev.clientX))
      setInspectorWidth(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDraggingInspector(false)
      saveInspectorWidth(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ---- auto-fit the whole workspace to this screen (the "Fit" button) ----
  // One shot: measure the live row, ask computeFitLayout for the optimal column
  // widths, then apply and persist them. The video sizes itself to its area, so
  // only the column widths are fitted; stacked (narrow) has nothing to fit.
  function fitLayout() {
    const el = splitRef.current
    if (!el) return
    const rowWidth = el.clientWidth
    const rowHeight = el.clientHeight
    const horizontal = getComputedStyle(el).flexDirection === 'row'
    if (!horizontal) return

    const fit = computeFitLayout({
      rowWidth,
      rowHeight,
      videoOverviewPool:
        (playerBoxRef.current?.clientHeight ?? 0) +
        (overviewRef.current?.clientHeight ?? 0),
      hasInspector: showDock,
    })

    setNotesWidth(fit.notesWidth)
    if (showDock) {
      setInspectorWidth(fit.inspectorWidth)
      saveInspectorWidth(fit.inspectorWidth)
    }
  }

  // The player|notes split goes side-by-side once its container is wide enough.
  // With the track rack gone the editor always spans the full viewport, so the
  // 660px breakpoint variant is the only one needed (shared with ShareViewer).
  const splitVariant = NOTES_SPLIT_660

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
        <span className="animate-now-pulse text-2xl text-accentink">◉</span>
        <span className="font-mono text-xs uppercase tracking-[0.2em]">
          Loading your tracks…
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-ink text-fg">
      {/* ---- Global header ---- */}
      {/* `chrome-dark`: in light mode the masthead keeps the active palette's
          dark-theme chrome (see index.css) — a dark bar anchoring the white
          page; the LED clock gets its glow back. No-op in dark mode.
          While the open track is editable ("armed"), the chrome takes the
          signal — `masthead-armed` washes it accent with an accent hairline,
          echoing the lit Edit key. View mode / the lock return it to panel. */}
      <header
        className={`chrome-dark flex h-[54px] items-center gap-3 border-b px-4 transition-colors duration-150 ${
          view === 'track' && !effectiveViewOnly
            ? 'masthead-armed'
            : 'border-line bg-panel'
        }`}
      >
        {/* The wordmark doubles as the way home (the title sub-bar's back
            arrow is the explicit route while a track is open). */}
        <button
          type="button"
          onClick={goHome}
          title="Back to the library"
          className="press flex items-center gap-[9px]"
        >
          <span className="h-[9px] w-[9px] rounded-full bg-accent shadow-[0_0_9px_rgb(var(--accent)/0.55)]" />
          <span className="hidden font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-fg min-[480px]:inline">
            Sound&nbsp;Annotator
          </span>
        </button>
        {view === 'track' && viewOnly && !lockBlocked && (
          <span className="flex h-[26px] shrink-0 items-center gap-1 whitespace-nowrap rounded border border-accent/60 bg-accent/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink">
            <Eye size={11} /> View only
          </span>
        )}
        <div className="flex-1" />
        {/* Undo / redo of structural changes (note add/delete/move/retime,
            tags, colours, ranges, sections, rename). Editing-only; the rich-text
            body keeps its own in-editor undo. ⌘Z / ⌘⇧Z (Ctrl on Win/Linux). */}
        {view === 'track' && !effectiveViewOnly && (
          <div
            role="group"
            aria-label="Undo and redo"
            className="flex items-center gap-px rounded-md border border-line bg-inset p-[2px]"
          >
            <button
              type="button"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
              aria-label="Undo"
              className="press flex h-[26px] w-[30px] items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-35"
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
              className="press flex h-[26px] w-[30px] items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-fg disabled:pointer-events-none disabled:opacity-35"
            >
              <Redo2 size={15} />
            </button>
          </div>
        )}
        {/* Mode toggle: a segmented switch (pencil | eye), icon-only.
            The Edit key lights solid accent while armed — the header wash
            echoes it; the active View segment stays a tonal fill with accent
            text. The 'V' key still flips it. */}
        {view === 'track' && !lockBlocked && (
          <div
            role="group"
            aria-label="Editing mode"
            className="flex items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]"
          >
            <button
              type="button"
              onClick={() => setViewMode(false)}
              aria-pressed={!viewOnly}
              title="Edit mode (V)"
              aria-label="Edit mode"
              className={`press flex h-[26px] w-[34px] items-center justify-center rounded transition-colors duration-150 ${
                viewOnly ? 'text-muted hover:text-fg' : 'bg-accent text-onaccent'
              }`}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode(true)}
              aria-pressed={viewOnly}
              title="View-only mode (V)"
              aria-label="View-only mode"
              className={`press flex h-[26px] w-[34px] items-center justify-center rounded transition-colors duration-150 ${
                viewOnly ? 'bg-raised text-accentink' : 'text-muted hover:text-fg'
              }`}
            >
              <Eye size={14} />
            </button>
          </div>
        )}
        {/* Edit lock: someone else (or another tab) holds this track's edit
            lock, or the owner turned link editing off. The status — and Take
            over, which makes the other session read-only — sits in the mode
            toggle's slot (the toggle is hidden while locked). */}
        {view === 'track' && lockBlocked && (
          <div
            role="group"
            aria-label="Edit lock"
            className="flex min-w-0 items-center gap-[2px] rounded-md border border-line bg-inset p-[2px]"
          >
            <span
              role="status"
              className="flex h-[26px] min-w-0 items-center gap-1.5 rounded bg-accent/10 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-accentink"
            >
              <Pencil size={12} className="shrink-0" />
              <span className="truncate">
                {editLock.state === 'other'
                  ? `${lockHolderLabel ?? 'Someone'} is editing`
                  : 'Editing turned off'}
              </span>
            </span>
            {editLock.state === 'other' && (
              <button
                type="button"
                onClick={editLock.takeOver}
                title="Take over editing — the other session becomes read-only"
                className="press flex h-[26px] shrink-0 items-center whitespace-nowrap rounded px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:bg-raised hover:text-accentink"
              >
                Take over
              </button>
            )}
          </div>
        )}
        <ThemeToggle
          pref={themePref}
          resolved={resolvedTheme}
          palette={palette}
          onChange={setThemePref}
          onPaletteChange={setPalette}
        />
        {view === 'track' && (
          <span className="hidden min-[860px]:block">
            <LevelMeter active={isPlaying} />
          </span>
        )}
        {view === 'track' && (
          <div className="bevel-inset hidden items-baseline gap-1.5 rounded border border-line bg-inset px-[13px] py-[7px] min-[720px]:flex">
            <span className="led text-[15px] font-medium leading-none">{formatTime(currentTime)}</span>
            <span className="font-mono text-[10.5px] text-muted">
              / {formatTime(duration)}
            </span>
          </div>
        )}

        {user && (
          <div className="flex items-center gap-[7px] border-l border-line pl-3">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt=""
                referrerPolicy="no-referrer"
                className="h-7 w-7 rounded-full border border-line-strong"
              />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-raised text-xs font-semibold uppercase text-fg">
                {(user.displayName ?? user.email ?? '?').slice(0, 1)}
              </span>
            )}
            <button
              onClick={() => void signOut()}
              title={`Sign out${user.email ? ` (${user.email})` : ''}`}
              aria-label="Sign out"
              className="press grid h-8 w-8 place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </header>

      {/* ---- Body: the home page (library), or the editor for the open track */}
      {!current ? (
        <HomePage
          // Foreign tracks (opened via an editable share link) ride along in
          // the session's project list but never join the home library.
          projects={projects.filter(
            (p) => !p.ownerId || p.ownerId === user?.uid,
          )}
          folders={folders}
          openFolderId={openFolderId}
          onOpenFolder={setOpenFolderId}
          onOpenTrack={openTrack}
          onCreateTrack={createProject}
          onDeleteTrack={removeProject}
          onMoveTrack={moveTrackToFolder}
          onCopyTrack={copyTrack}
          onShareTrack={enableTrackShare}
          onCreateFolder={createFolder}
          onRenameFolder={renameFolder}
          onDeleteFolder={deleteFolder}
        />
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Sub-bar: track title + per-track tools. */}
          <div className="flex h-[50px] items-center gap-2 border-b border-line bg-ink/60 px-3.5">
            {/* Back to where the track lives: its folder, or the root library. */}
            <button
              type="button"
              onClick={goBack}
              title={`Back to ${
                folders.find((f) => f.id === current.folderId)?.name ??
                'the library'
              }`}
              aria-label="Back"
              className="press -ml-1 grid h-8 w-8 shrink-0 place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
            >
              <ArrowLeft size={16} />
            </button>
            {effectiveViewOnly ? (
              <span className="min-w-0 truncate rounded px-[9px] py-[5px] text-[14.5px] font-semibold tracking-[0.01em] text-fg">
                {current.title}
              </span>
            ) : (
              /* The input hugs its text — an invisible twin of the title sets
                 the grid cell's width — and a pencil fades in on hover (and
                 while editing) as the "this is editable" cue. */
              <div className="group flex min-w-0 items-center gap-1.5">
                <div className="inline-grid min-w-0">
                  <span
                    aria-hidden
                    className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre px-[9px] py-[5px] text-[14.5px] font-semibold tracking-[0.01em]"
                  >
                    {current.title || 'Untitled track'}
                  </span>
                  <input
                    value={current.title}
                    onChange={(e) =>
                      commitProject(
                        current.id,
                        { title: e.target.value },
                        { coalesceKey: `title:${current.id}` },
                      )
                    }
                    placeholder="Untitled track"
                    aria-label="Track title"
                    className="col-start-1 row-start-1 w-full min-w-0 rounded bg-transparent px-[9px] py-[5px] text-[14.5px] font-semibold tracking-[0.01em] text-fg transition-colors placeholder:text-muted hover:bg-fg/5"
                  />
                </div>
                <Pencil
                  size={12}
                  aria-hidden
                  className="shrink-0 text-muted opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100"
                />
              </div>
            )}
            {/* Save indicator: editing… (dirty, debouncing) → saving… (write in
                flight) → saved. Driven by the persistence effect above. */}
            {saveStatus !== 'idle' && (
              <div
                role="status"
                aria-live="polite"
                className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted"
              >
                {saveStatus === 'editing' && (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                    Editing…
                  </>
                )}
                {saveStatus === 'saving' && (
                  <>
                    <span className="h-1.5 w-1.5 animate-now-pulse rounded-full bg-accent" />
                    Saving…
                  </>
                )}
                {saveStatus === 'saved' && (
                  <span className="flex items-center gap-1 text-meter">
                    <Check size={12} /> Saved
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-accentink">Save failed</span>
                )}
              </div>
            )}
            <div className="min-w-0 flex-1" />
            {canEditSettings && (
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                title="Settings"
                aria-label="Open settings"
                className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                <SettingsIcon size={12} />
                Settings
              </button>
            )}
            {current.source && (
              <button
                type="button"
                onClick={fitLayout}
                title="Auto-fit the layout to this screen (player, overview, notes, inspector)"
                aria-label="Fit layout to screen"
                className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-3 py-[7px] font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
              >
                <Proportions size={12} />
                Fit
              </button>
            )}
            {current.source && <ExportPdfButton project={current} />}
            {/* Sharing is the owner's call alone — never shown on a foreign
                (link-edited) track; the rules refuse the writes anyway. */}
            {current.source && !isForeign && (
              <SharePanel
                project={current}
                onChange={(patch) => patchProject(current.id, patch)}
              />
            )}
          </div>

          {/* Body */}
          {!current.source ? (
            <div className="flex-1 animate-fade-in overflow-y-auto px-6 py-6">
              {/* The source (and its Storage path) belongs to the owner — a
                  link editor annotates, they don't re-source the track. */}
              {effectiveViewOnly || isForeign ? (
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
              {effectiveViewOnly || isForeign ? (
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
              style={splitStyle}
            >
              {/* Viewer panel — the flex column: absorbs window resize so the
                  notes column keeps its width. The video fills the room the short
                  overview strip leaves (--player-max-h tracks the player area). */}
              <div
                className={`flex shrink-0 flex-col overflow-hidden border-b border-line ${splitVariant.player}`}
              >
                <TitleBar
                  left="Player"
                  right={current.source.type === 'youtube' ? undefined : 'Audio'}
                  actions={
                    <>
                      {current.source.type === 'youtube' && (
                        <a
                          href={
                            current.source.youtubeUrl ??
                            (current.source.videoId
                              ? `https://www.youtube.com/watch?v=${current.source.videoId}`
                              : undefined)
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open the original video on YouTube (new tab)"
                          className="press inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
                        >
                          <Play size={12} />
                          YouTube
                        </a>
                      )}
                      {/* Detection is the owner's call (it spends their
                          Replicate credit): audio tracks need their cloud
                          URL; YouTube tracks prompt for a one-shot analysis
                          upload inside the button. */}
                      {user &&
                        !effectiveViewOnly &&
                        !isForeign &&
                        (current.source.type === 'youtube' ||
                          current.source.audioUrl) && (
                          <DetectSectionsButton
                            key={current.id}
                            projectId={current.id}
                            uploadAnalysisAudio={(file, onProgress) =>
                              uploadAnalysisAudio(
                                user.uid,
                                current.id,
                                file,
                                onProgress,
                              )
                            }
                            onSections={applyDetectedSections}
                          />
                        )}
                    </>
                  }
                />
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-3.5">
                  <div
                    ref={setPlayerArea}
                    className="flex min-h-0 flex-1 flex-col justify-center"
                  >
                    <div ref={playerBoxRef}>
                      <PlayerPane
                        ref={playerRef}
                        source={current.source}
                        audioUrl={audioUrl}
                        regionSpecs={regionSpecs}
                        playbackRate={playbackRate}
                        volume={stemActive || muted ? 0 : volume}
                        readOnly={effectiveViewOnly}
                        onTime={handleTime}
                        onDuration={handleDuration}
                        onPlayingChange={handlePlaying}
                        onSeek={seek}
                        onCreateRange={createRange}
                        onUpdateRegion={updateRegionGeom}
                      />
                    </div>
                  </div>

                  {uploadPct != null && (
                    <div className="flex shrink-0 items-center gap-2 rounded border border-line bg-inset px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted">
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
                    playbackRate={playbackRate}
                    volume={volume}
                    muted={muted}
                    readOnly={effectiveViewOnly}
                    onPlayPause={() => (isPlaying ? pause() : play())}
                    onSeek={seek}
                    onStep={step}
                    onSetRate={setPlaybackRate}
                    onSetVolume={changeVolume}
                    onToggleMute={toggleMute}
                  />

                  {/* Stem mixer — only on analyzed tracks (section detection
                      saved their separated stems). Playback-only, so it stays
                      available in view mode. */}
                  {current.stems && (
                    <StemMixer
                      key={current.id}
                      stems={current.stems}
                      playerRef={playerRef}
                      isPlaying={isPlaying}
                      volume={muted ? 0 : volume}
                      playbackRate={playbackRate}
                      onActiveChange={setStemActive}
                    />
                  )}
                </div>

                {/* A short, toggleable timeline strip below the player. The
                    timeline carries its own fixed height; collapsed, it's just
                    the header strip. */}
                <div ref={overviewRef} className="flex shrink-0 flex-col">
                  <TrackOverview
                    resetKey={current.id}
                    annotations={current.annotations}
                    duration={duration}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    open={overviewOpen}
                    onToggleOpen={toggleOverview}
                    onSeek={seek}
                    onSeekNote={seekToNote}
                  />
                </div>
              </div>

              {/* Drag handle — resize the split (double-click to reset). The
                  player (flex) absorbs it; the docked inspector width (when
                  present) is reserved so the notes column hugs its right edge. */}
              <SplitHandle
                variantClass={splitVariant.handle}
                dragging={draggingNotes}
                onPointerDown={(e) =>
                  startSplitDrag(e, showDock ? inspectorWidth : 0)
                }
                onDoubleClick={resetSplit}
              />

              {/* Notes panel — the fixed-width column (pinned to --notes-w on
                  wide screens; fills height when stacked). */}
              <div
                className={`flex min-w-0 flex-1 flex-col ${splitVariant.notes}`}
              >
                <TitleBar
                  left={`Notes (${
                    isFiltered
                      ? `${visibleAnnotations.length} / ${current.annotations.length}`
                      : current.annotations.length
                  })`}
                  actions={
                    <NotesHeaderControls
                      filterTags={filterTags}
                      filterTagCounts={filterTagCounts}
                      activeFilter={activeFilter}
                      onTagFilter={setTagFilter}
                      noteOrder={noteOrder}
                      onNoteOrder={changeNoteOrder}
                      searchOpen={searchOpen}
                      searchActive={search.trim() !== ''}
                      onToggleSearch={toggleSearch}
                      viewOnly={effectiveViewOnly}
                    />
                  }
                />
                {searchOpen && (
                  <NotesSearch
                    value={search}
                    onChange={setSearch}
                    count={visibleAnnotations.length}
                    total={current.annotations.length}
                    onClose={toggleSearch}
                  />
                )}
                {!effectiveViewOnly && (
                  <NoteActions
                    pendingIn={pendingIn}
                    currentTime={currentTime}
                    onMarkIn={markIn}
                    onMarkOut={markOut}
                    onCancelMark={() => setPendingIn(null)}
                    onAddNote={addAnnotationAtCurrent}
                    onAddNoteAt={addNoteAt}
                  />
                )}
                <div
                  ref={setNotesScroll}
                  className={`relative flex-1 overflow-y-auto ${
                    resolvedTheme === 'light' ? 'bg-rowsel' : 'bg-note'
                  }`}
                >
                  <AnnotationList
                    annotations={visibleAnnotations}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    playbackRate={playbackRate}
                    readOnly={effectiveViewOnly}
                    filtered={isFiltered}
                    scrollRef={notesScrollRef}
                    noteOrder={noteOrder}
                    autoPin={autoPin}
                    selectedId={selectedNoteId}
                    onSelect={selectNote}
                    onSeek={seek}
                    onPlay={play}
                    onPlayPassage={playPassage}
                    passageId={passageId}
                    playOnce={playOnce}
                    onReorder={reorderAnnotations}
                    onSeekNote={seekToNote}
                    mentionItems={getMentionItems}
                  />
                  {visibleAnnotations.length > 0 && (
                    <div aria-hidden style={{ height: notesPad }} />
                  )}
                </div>
              </div>

              {/* Drag handle to resize the notes / inspector boundary. */}
              {showDock && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize notes and inspector"
                  onPointerDown={startInspectorDrag}
                  title="Drag to resize"
                  className={`w-1 shrink-0 cursor-col-resize touch-none transition-colors ${
                    draggingInspector ? 'bg-accent' : 'bg-line hover:bg-accent/60'
                  }`}
                />
              )}

              {/* Note inspector — a persistent docked 3rd column (wide screens in
                  edit mode). Shows the selected note's editor, or an empty state
                  when nothing's selected. Slides in once on mount, then stays. */}
              {showDock && (
                <div
                  className="dock-slide-in min-w-0 shrink-0 overflow-hidden"
                  style={{
                    // Cap against the viewport so a wide inspector + a shrunk
                    // window can never starve the player+notes (they keep ≥700px).
                    ['--inspector-w' as string]: `min(${inspectorWidth}px, calc(100vw - 700px))`,
                  }}
                >
                  <div className="h-full w-[var(--inspector-w)]">
                    <PluginWindow
                      title="Note"
                      subtitle={inspectorSubtitle}
                      mode="dock"
                      onSetMode={changeWindowMode}
                      // The dock is persistent; ✕ just deselects (→ empty state).
                      // Only shown when there's a note to deselect.
                      onClose={
                        selectedNote ? () => setSelectedNoteId(null) : undefined
                      }
                    >
                      {selectedNote ? (
                        <NoteInspector
                          key={`${selectedNote.id}:${epoch}`}
                          annotation={selectedNote}
                          color={selectedNote.color ?? colorForId(selectedNote.id)}
                          projectTags={projectTags}
                          currentTime={currentTime}
                          isPlaying={isPlaying}
                          playbackRate={playbackRate}
                          autoFocus={focusNoteId === selectedNote.id}
                          onFocusHandled={() => setFocusNoteId(null)}
                          onUpdate={(patch, opts) =>
                            updateAnnotation(selectedNote.id, patch, opts)
                          }
                          onDelete={() => deleteAnnotation(selectedNote.id)}
                          onSeek={seek}
                          onSeekNote={seekToNote}
                          mentionItems={getMentionItems}
                          uploadImage={handleUploadImage}
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                          <Pencil size={22} className="text-muted/50" />
                          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
                            No note selected
                          </p>
                          <p className="max-w-[16rem] text-[12px] leading-relaxed text-muted/70">
                            Click a note to edit it here, or add one with the
                            button above.
                          </p>
                        </div>
                      )}
                    </PluginWindow>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      )}

      {/* Note inspector — modal overlay (narrow screens or chosen mode) */}
      {showModal && selectedNote && (
        <PluginWindow
          title="Note"
          subtitle={inspectorSubtitle}
          mode="modal"
          onSetMode={changeWindowMode}
          onClose={() => setSelectedNoteId(null)}
        >
          <NoteInspector
            key={`${selectedNote.id}:${epoch}`}
            annotation={selectedNote}
            color={selectedNote.color ?? colorForId(selectedNote.id)}
            projectTags={projectTags}
            currentTime={currentTime}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            autoFocus={focusNoteId === selectedNote.id}
            onFocusHandled={() => setFocusNoteId(null)}
            onUpdate={(patch, opts) => updateAnnotation(selectedNote.id, patch, opts)}
            onDelete={() => deleteAnnotation(selectedNote.id)}
            onSeek={seek}
            onSeekNote={seekToNote}
            mentionItems={getMentionItems}
            uploadImage={handleUploadImage}
          />
        </PluginWindow>
      )}

      {help.mounted && (
        <ShortcutsOverlay
          closing={help.closing}
          onClose={() => setShowHelp(false)}
        />
      )}
      {showSettings && (
        <SettingsModal
          playOnce={playOnce}
          onPlayOnce={setPlayOnce}
          overviewOpen={overviewOpen}
          onOverviewOpen={setOverviewOpenPref}
          noteOrder={noteOrder}
          onNoteOrder={changeNoteOrder}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

function LevelMeter({ active }: { active: boolean }) {
  const SEGS = 16
  return (
    <div
      className="flex h-[18px] items-end gap-[2.5px]"
      title="Output level"
      aria-hidden="true"
    >
      {Array.from({ length: SEGS }, (_, i) => {
        const color =
          i >= 14
            ? 'rgb(var(--peak))'
            : i >= 11
              ? 'rgb(var(--accent))'
              : 'rgb(var(--meter))'
        return (
          <span
            key={i}
            className={`origin-bottom rounded-[2px] ${active ? 'meter-seg' : ''}`}
            style={{
              width: '3.5px',
              height: `${30 + Math.sin((i / (SEGS - 1)) * Math.PI) * 60}%`,
              background: color,
              opacity: active ? undefined : i < 5 ? 0.55 : 0.2,
              animationDelay: active ? `${i * 45}ms` : undefined,
              animationDuration: active ? `${700 + (i % 5) * 90}ms` : undefined,
            }}
          />
        )
      })}
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
      <label className="mt-3 inline-flex cursor-pointer rounded border border-accent/70 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-accentink hover:bg-accent/20">
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
