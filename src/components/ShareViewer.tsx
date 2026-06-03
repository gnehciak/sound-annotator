import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, ExternalLink } from 'lucide-react'
import type { PlayerHandle, Project } from '../types'
import { firebaseReady } from '../lib/firebase'
import { fetchSharedProject } from '../lib/projectStore'
import { colorForId } from '../lib/noteColors'
import { noteLabel, notePreview } from '../lib/format'
import PlayerPane from './PlayerPane'
import Transport from './Transport'
import AnnotationList from './AnnotationList'
import type { MentionItem } from './MentionList'

type Status = 'loading' | 'ready' | 'notfound'

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

  const playerRef = useRef<PlayerHandle>(null)
  const notesScrollRef = useRef<HTMLDivElement>(null)

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

  const handleTime = useCallback((t: number) => setCurrentTime(t), [])
  const handleDuration = useCallback((d: number) => setDuration(d), [])
  const handlePlaying = useCallback((p: boolean) => setIsPlaying(p), [])

  const seek = useCallback((t: number) => {
    playerRef.current?.seekTo(t)
    setCurrentTime(t)
  }, [])
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
          tag: a.tag,
          preview: notePreview(a.contentHtml),
        }))
        .filter(
          (it) =>
            !q ||
            it.label.toLowerCase().includes(q) ||
            (it.tag ?? '').includes(q) ||
            it.preview.toLowerCase().includes(q),
        )
    },
    [annotations],
  )

  if (status === 'loading') {
    return (
      <div className="flex h-full animate-fade-in flex-col items-center justify-center gap-3 bg-ink text-muted">
        <span className="animate-now-pulse text-2xl text-accent">◉</span>
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
          <span className="text-accent">◉</span>
          <h1 className="mt-3 text-lg font-semibold">Link unavailable</h1>
          <p className="mt-2 text-sm text-muted">
            This shared track doesn’t exist or sharing was turned off. Ask
            whoever sent the link to share it again.
          </p>
          <a
            href={window.location.pathname}
            className="press bevel-raised mt-6 inline-flex items-center justify-center gap-1.5 bg-accent px-4 py-2 text-sm font-bold text-ink hover:brightness-110"
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
        <span className="text-accent">◉</span>
        <span className="hidden text-xs font-semibold uppercase tracking-[0.22em] text-fg sm:inline">
          Sound&nbsp;Annotator
        </span>
        <span className="flex items-center gap-1 rounded border border-accent/60 bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent">
          <Eye size={11} /> Read only
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-fg">
          {project.title}
        </span>
        <a
          href={window.location.pathname}
          title="Open the full app"
          className="press inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted hover:border-line-strong hover:text-fg"
        >
          <ExternalLink size={12} /> <span className="hidden sm:inline">Open app</span>
        </a>
      </header>

      {/* Body: player on top/left, notes on bottom/right */}
      <div className="flex min-h-0 flex-1 flex-col min-[660px]:flex-row">
        <div className="flex shrink-0 flex-col overflow-y-auto border-b border-line min-[660px]:w-[440px] min-[660px]:max-w-[60%] min-[660px]:border-b-0 min-[660px]:border-r">
          <TitleBar
            left="Player"
            right={source?.type === 'youtube' ? 'YouTube' : 'Audio'}
          />
          <div className="space-y-2.5 p-3">
            {hasPlayer ? (
              <PlayerPane
                ref={playerRef}
                source={source}
                audioUrl={audioUrl}
                regionSpecs={regionSpecs}
                playbackRate={playbackRate}
                readOnly
                onTime={handleTime}
                onDuration={handleDuration}
                onPlayingChange={handlePlaying}
                onSeek={seek}
                onCreateRange={() => {}}
                onUpdateRegion={() => {}}
              />
            ) : (
              <div className="border border-dashed border-line p-6 text-center text-sm text-muted">
                The audio for this track isn’t available, but the notes below are
                still here.
              </div>
            )}

            {hasPlayer && (
              <Transport
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                pendingIn={null}
                playbackRate={playbackRate}
                hasNotes={annotations.length > 0}
                readOnly
                onPlayPause={() => (isPlaying ? pause() : play())}
                onSeek={seek}
                onSetRate={setPlaybackRate}
                onPrevNote={() => jumpNote(-1)}
                onNextNote={() => jumpNote(1)}
                onMarkIn={() => {}}
                onMarkOut={() => {}}
                onCancelMark={() => {}}
                onAddNote={() => {}}
              />
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <TitleBar
            left="Notes"
            right={`${annotations.length} ${annotations.length === 1 ? 'note' : 'notes'}`}
          />
          <div ref={notesScrollRef} className="relative flex-1 overflow-y-auto">
            <AnnotationList
              annotations={annotations}
              currentTime={currentTime}
              isPlaying={isPlaying}
              readOnly
              scrollRef={notesScrollRef}
              onSeek={seek}
              onPlay={play}
              onUpdate={() => {}}
              onDelete={() => {}}
              onSeekNote={seekToNote}
              mentionItems={getMentionItems}
            />
          </div>
        </div>
      </div>
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
