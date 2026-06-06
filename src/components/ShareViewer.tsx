import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, ExternalLink } from 'lucide-react'
import type { PlayerHandle, Project } from '../types'
import { firebaseReady } from '../lib/firebase'
import { fetchSharedProject } from '../lib/projectStore'
import { loadVolume, saveVolume, DEFAULT_VOLUME } from '../lib/storage'
import { colorForId } from '../lib/noteColors'
import { tagsOf } from '../lib/tags'
import { noteLabel, notePreview } from '../lib/format'
import PlayerPane from './PlayerPane'
import Transport from './Transport'
import AnnotationList from './AnnotationList'
import TitleBar from './TitleBar'
import NotesHeaderControls from './NotesHeaderControls'
import NotesSearch from './NotesSearch'
import SplitHandle from './SplitHandle'
import ExportPdfButton from './ExportPdfButton'
import CopyProjectButton from './CopyProjectButton'
import { useNotesView } from '../lib/useNotesView'
import { useNotesSplit, NOTES_SPLIT_660 } from '../lib/notesSplit'
import type { MentionItem } from './MentionList'

type Status = 'loading' | 'ready' | 'notfound'

// How long consecutive ±step seeks keep accumulating before re-anchoring to
// the live playhead (see `step`).
const STEP_WINDOW = 1200

/**
 * Read-only viewer for a shared project, rendered (outside the auth Gate) when
 * the URL carries `?view={id}`. Anyone with the link can open it — no sign-in.
 * It reuses the same player + transport + notes components the editor uses, all
 * in `readOnly` mode, so clicking a note seeks the track but nothing is editable.
 */
export default function ShareViewer({ projectId }: { projectId: string }) {
  // Without Firebase configured there's nothing to fetch — start at 'notfound'.
  const [status, setStatus] = useState<Status>(() =>
    firebaseReady ? 'loading' : 'notfound',
  )
  const [project, setProject] = useState<Project | null>(null)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [volume, setVolume] = useState(loadVolume)
  const [muted, setMuted] = useState(false)
  const [notesPad, setNotesPad] = useState(0)
  const [searchOpen, setSearchOpen] = useState(false)

  // Reveal/dismiss the notes search; closing clears the query (see App).
  function toggleSearch() {
    if (searchOpen) {
      setSearch('')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
    }
  }
  function changeVolume(v: number) {
    setVolume(v)
    saveVolume(v)
    if (v > 0) setMuted(false)
  }
  function toggleMute() {
    if (muted) {
      setMuted(false)
      if (volume === 0) {
        setVolume(DEFAULT_VOLUME)
        saveVolume(DEFAULT_VOLUME)
      }
    } else {
      setMuted(true)
    }
  }

  const playerRef = useRef<PlayerHandle>(null)
  const notesScrollRef = useRef<HTMLDivElement | null>(null)
  const notesRoRef = useRef<ResizeObserver | null>(null)

  // Pad the bottom of the notes panel so the playing note can still scroll to
  // the top (auto-pin) even when the notes don't fill the panel. Mirrors App.
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
  // fills the space the overview rail used to occupy (capped + centred) instead
  // of the default 50vh. Guarded against re-applying so it can't loop.
  const playerAreaRoRef = useRef<ResizeObserver | null>(null)
  const playerMaxHRef = useRef(-1)
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

  // Accumulate consecutive ±step seeks (the 1s/5s buttons) against a
  // short-lived target instead of the advancing playhead — mirrors the editor
  // so slow taps keep moving instead of being eaten by playback between them.
  const seekTargetRef = useRef<number | null>(null)
  const lastStepRef = useRef(0)

  // Fetch once. firestore.rules only returns the doc when it's `shared`, so a
  // private or missing id resolves to null → "not available".
  useEffect(() => {
    if (!firebaseReady) return
    let cancelled = false
    fetchSharedProject(projectId).then((p) => {
      if (cancelled) return
      setProject(p)
      setStatus(p ? 'ready' : 'notfound')
      if (p) document.title = `${p.title} — Sound Annotator`
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const annotations = useMemo(() => project?.annotations ?? [], [project])

  // The same resizable split + notes-view controls the editor uses (read-only
  // here, but filter/order/pin/cue never mutate notes).
  const {
    splitRef,
    dragging: draggingNotes,
    startSplitDrag,
    resetSplit,
    style: splitStyle,
  } = useNotesSplit()
  const {
    noteOrder,
    changeNoteOrder,
    autoPin,
    autoSeek,
    toggleAutoSeek,
    setTagFilter,
    filterTags,
    activeFilter,
    search,
    setSearch,
    isFiltered,
    visibleAnnotations,
  } = useNotesView(annotations, true)

  const handleTime = useCallback((t: number) => setCurrentTime(t), [])
  const handleDuration = useCallback((d: number) => setDuration(d), [])
  const handlePlaying = useCallback((p: boolean) => setIsPlaying(p), [])

  const seek = useCallback((t: number) => {
    playerRef.current?.seekTo(t)
    setCurrentTime(t)
  }, [])

  const step = useCallback(
    (delta: number) => {
      const recent = Date.now() - lastStepRef.current < STEP_WINDOW
      const base =
        recent && seekTargetRef.current != null
          ? seekTargetRef.current
          : playerRef.current?.getCurrentTime?.() ?? currentTime
      let target = base + delta
      if (duration > 0) target = Math.min(target, duration)
      target = Math.max(0, target)
      seekTargetRef.current = target
      lastStepRef.current = Date.now()
      seek(target)
    },
    [currentTime, duration, seek],
  )
  const play = useCallback(() => {
    setIsPlaying(true)
    playerRef.current?.play()
  }, [])
  const pause = useCallback(() => {
    setIsPlaying(false)
    playerRef.current?.pause()
  }, [])

  const seekToNote = useCallback(
    (id: string) => {
      const a = annotations.find((x) => x.id === id)
      if (!a) return
      seek(a.start)
      document
        .getElementById(`note-${id}`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
    [annotations, seek],
  )

  // Seek to the note before/after the playhead (mirrors the editor's jumpNote).
  const jumpNote = useCallback(
    (dir: 1 | -1) => {
      if (annotations.length === 0) return
      const sorted = [...annotations].sort((a, b) => a.start - b.start)
      const eps = 0.3
      const target =
        dir === 1
          ? sorted.find((a) => a.start > currentTime + eps)
          : [...sorted].reverse().find((a) => a.start < currentTime - eps)
      if (target) seekToNote(target.id)
    },
    [annotations, currentTime, seekToNote],
  )

  const regionSpecs = useMemo(
    () =>
      annotations.map((a) => ({
        id: a.id,
        start: a.start,
        end: a.end,
        color: colorForId(a.id),
      })),
    [annotations],
  )

  const getMentionItems = useCallback(
    (query: string): MentionItem[] => {
      const q = query.trim().toLowerCase()
      return annotations
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
    },
    [annotations],
  )

  if (status === 'loading') {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-3 bg-ink text-muted">
        <span className="animate-now-pulse text-2xl text-accentink">◉</span>
        <span className="font-mono text-xs uppercase tracking-[0.2em]">
          Opening shared track…
        </span>
      </div>
    )
  }

  if (status === 'notfound' || !project) {
    return (
      <div className="flex h-full items-center justify-center bg-ink p-6 text-fg">
        <div className="w-full max-w-md border border-line bg-panel p-8 text-center">
          <span className="text-accentink">◉</span>
          <h1 className="mt-3 text-lg font-semibold">Link unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            This shared track doesn’t exist or sharing was turned off. Ask
            whoever sent the link to share it again.
          </p>
          <a
            href={window.location.pathname}
            className="press bevel-raised mt-6 inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 text-sm font-bold text-onbright hover:brightness-110"
          >
            Open Sound Annotator
          </a>
        </div>
      </div>
    )
  }

  const source = project.source
  const audioUrl = source?.type === 'audio' ? (source.audioUrl ?? null) : null
  const hasPlayer =
    (source?.type === 'youtube' && !!source.videoId) ||
    (source?.type === 'audio' && !!audioUrl)

  return (
    <div className="flex h-full flex-col bg-ink text-fg">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <span className="text-accentink">◉</span>
        <span className="hidden text-xs font-semibold uppercase tracking-[0.22em] text-fg sm:inline">
          Sound&nbsp;Annotator
        </span>
        <span className="flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accentink">
          <Eye size={11} /> Read only
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-fg">
          {project.title}
        </span>
        <ExportPdfButton project={project} />
        <CopyProjectButton project={project} />
        <a
          href={window.location.pathname}
          title="Open the full app"
          className="press inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-line-strong hover:text-fg"
        >
          <ExternalLink size={12} /> <span className="hidden sm:inline">Open app</span>
        </a>
      </header>

      {/* Body: the same resizable player|notes split the editor uses — notes is
          the fixed column, the player flexes (and stacks above on narrow). */}
      <div
        ref={splitRef}
        className={`flex min-h-0 flex-1 flex-col ${NOTES_SPLIT_660.row}`}
        style={splitStyle}
      >
        {/* Player column — the flex column. The read-only view has no overview
            rail, so the player fills the freed height; the transport pins below. */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden border-b border-line ${NOTES_SPLIT_660.player}`}
        >
          <TitleBar
            left="Player"
            right={source?.type === 'youtube' ? 'YouTube' : 'Audio'}
          />
          <div className="flex min-h-0 flex-1 flex-col gap-2.5 p-3">
            {hasPlayer ? (
              <>
                <div
                  ref={setPlayerArea}
                  className={
                    source?.type === 'youtube'
                      ? 'flex min-h-0 flex-1 flex-col justify-center'
                      : 'shrink-0'
                  }
                >
                  <PlayerPane
                    ref={playerRef}
                    source={source}
                    audioUrl={audioUrl}
                    regionSpecs={regionSpecs}
                    playbackRate={playbackRate}
                    volume={muted ? 0 : volume}
                    readOnly
                    onTime={handleTime}
                    onDuration={handleDuration}
                    onPlayingChange={handlePlaying}
                    onSeek={seek}
                    onCreateRange={() => {}}
                    onUpdateRegion={() => {}}
                  />
                </div>

                <Transport
                  isPlaying={isPlaying}
                  currentTime={currentTime}
                  duration={duration}
                  playbackRate={playbackRate}
                  volume={volume}
                  muted={muted}
                  hasNotes={annotations.length > 0}
                  readOnly
                  onPlayPause={() => (isPlaying ? pause() : play())}
                  onSeek={seek}
                  onStep={step}
                  onSetRate={setPlaybackRate}
                  onSetVolume={changeVolume}
                  onToggleMute={toggleMute}
                  onPrevNote={() => jumpNote(-1)}
                  onNextNote={() => jumpNote(1)}
                />
              </>
            ) : (
              <div className="border border-dashed border-line p-6 text-center text-sm text-muted">
                The audio for this track isn’t available, but the notes below are
                still here.
              </div>
            )}
          </div>
        </div>

        {/* Drag handle — resize the split (double-click to reset). */}
        <SplitHandle
          variantClass={NOTES_SPLIT_660.handle}
          dragging={draggingNotes}
          onPointerDown={(e) => startSplitDrag(e, 0)}
          onDoubleClick={resetSplit}
        />

        {/* Notes column — the fixed-width column. */}
        <div className={`flex min-w-0 flex-1 flex-col ${NOTES_SPLIT_660.notes}`}>
          <TitleBar
            left="Notes"
            right={
              isFiltered
                ? `${visibleAnnotations.length} / ${annotations.length}`
                : `${annotations.length} ${annotations.length === 1 ? 'note' : 'notes'}`
            }
            actions={
              <NotesHeaderControls
                filterTags={filterTags}
                activeFilter={activeFilter}
                onTagFilter={setTagFilter}
                noteOrder={noteOrder}
                onNoteOrder={changeNoteOrder}
                autoSeek={autoSeek}
                onToggleAutoSeek={toggleAutoSeek}
                searchOpen={searchOpen}
                searchActive={search.trim() !== ''}
                onToggleSearch={toggleSearch}
                viewOnly
              />
            }
          />
          {searchOpen && (
            <NotesSearch
              value={search}
              onChange={setSearch}
              count={visibleAnnotations.length}
              total={annotations.length}
              onClose={toggleSearch}
            />
          )}
          <div
            ref={setNotesScroll}
            className="relative flex-1 overflow-y-auto"
          >
            <AnnotationList
              annotations={visibleAnnotations}
              currentTime={currentTime}
              isPlaying={isPlaying}
              playbackRate={playbackRate}
              readOnly
              filtered={isFiltered}
              scrollRef={notesScrollRef}
              noteOrder={noteOrder}
              autoPin={autoPin}
              onSeek={seek}
              onPlay={play}
              onSeekNote={seekToNote}
              mentionItems={getMentionItems}
            />
            {visibleAnnotations.length > 0 && (
              <div aria-hidden style={{ height: notesPad }} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
