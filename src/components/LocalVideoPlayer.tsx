import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Loader2, Play, TriangleAlert } from 'lucide-react'
import type { PlayerHandle } from '../types'
import { localVideoUrl } from '../lib/videoDownload'

interface Props {
  /** Floating chrome rendered inside the 16:9 frame, above the picture. */
  overlay?: ReactNode
  /** The PDF score, drawn over the picture and under the transport. */
  score?: ReactNode
  /** The project whose downloaded copy this plays (served by api/projects/[id]/video.ts). */
  projectId: string
  /** Clip window in seconds of the source video (see ProjectSource.clipStart). */
  clipStart?: number
  clipEnd?: number
  playbackRate: number
  volume: number
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
  /** The stored copy wouldn't load — offer to go back to the YouTube embed. */
  onFallback?: () => void
}

/** Clip span, the video's real duration standing in for an open `to`. Mirrors
 *  DrivePlayer's; same clamping, same reasons. */
const clipLen = (videoLen: number, win: { from: number; to: number }) =>
  Math.max(0, Math.min(win.to, videoLen) - Math.min(win.from, videoLen))

/**
 * Plays a track's *downloaded* YouTube copy — the same plain `<video>` as
 * DrivePlayer, only pointed at the download proxy instead of Drive's. Its
 * chrome matches the other two players (16:9 frame, play circle, spinner) so
 * the three source paths feel like one player. The one thing it adds over
 * DrivePlayer is a way back: a stored copy that won't load (the object aged out
 * of the cache, a store hiccup) should fall straight back to the embed that
 * always works, not strand the reader on an error.
 */
const LocalVideoPlayer = forwardRef<PlayerHandle, Props>(function LocalVideoPlayer(
  {
    overlay,
    score,
    projectId,
    clipStart,
    clipEnd,
    playbackRate,
    volume,
    onTime,
    onDuration,
    onPlayingChange,
    onFallback,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Clip time (0 = clipStart), like every other time in the app.
  const timeRef = useRef(0)
  const from = Math.max(0, clipStart ?? 0)
  const winRef = useRef({ from, to: clipEnd ?? Infinity })
  winRef.current = { from, to: clipEnd ?? Infinity }
  const pendingSeekRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)

  // A new track is a new load.
  useEffect(() => {
    setReady(false)
    setBuffering(false)
    setPlaying(false)
    setFailed(false)
    timeRef.current = 0
    pendingSeekRef.current = null
  }, [projectId])

  // Apply live speed / volume changes; both also seed the element on mount.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate, projectId])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = Math.min(1, Math.max(0, volume))
    v.muted = volume <= 0
  }, [volume, projectId])

  // A clip edit doesn't reload the video (winRef already carries the new
  // edges): re-report the length, and pull the playhead back inside if the
  // window moved out from under it.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !Number.isFinite(v.duration)) return
    const { from, to } = winRef.current
    onDuration(clipLen(v.duration, winRef.current))
    if (v.currentTime < from || v.currentTime > to) {
      v.currentTime = Math.min(Math.max(v.currentTime, from), to)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, clipEnd])

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        setBuffering(true)
        void videoRef.current?.play().catch(() => setBuffering(false))
      },
      pause: () => videoRef.current?.pause(),
      seekTo: (s: number) => {
        const { from, to } = winRef.current
        const target = Math.min(Math.max(from + s, from), to)
        const v = videoRef.current
        if (!v || !Number.isFinite(v.duration)) {
          pendingSeekRef.current = target
          timeRef.current = Math.max(0, target - from)
          return
        }
        v.currentTime = Math.min(target, v.duration)
      },
      getCurrentTime: () => timeRef.current,
    }),
    [],
  )

  /** Report the playhead in clip time, stopping at the window's end. */
  function tick() {
    const v = videoRef.current
    if (!v) return
    const { from, to } = winRef.current
    if (!v.paused && v.currentTime >= to) {
      v.pause()
      v.currentTime = Math.min(to, v.duration || to)
      timeRef.current = to - from
      onTime(timeRef.current)
      return
    }
    timeRef.current = Math.max(0, v.currentTime - from)
    onTime(timeRef.current)
  }

  return (
    <div
      className="video-glow relative mx-auto aspect-video w-full overflow-hidden rounded-lg border border-line/70 bg-black"
      style={{ maxWidth: 'calc(var(--player-max-h, 50vh) * 16 / 9)' }}
    >
      <video
        ref={videoRef}
        key={projectId}
        src={localVideoUrl(projectId)}
        preload="metadata"
        playsInline
        className="h-full w-full"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setReady(true)
          setFailed(false)
          v.playbackRate = playbackRate
          v.volume = Math.min(1, Math.max(0, volume))
          v.muted = volume <= 0
          onDuration(clipLen(v.duration || 0, winRef.current))
          const pending = pendingSeekRef.current
          pendingSeekRef.current = null
          const target = pending ?? winRef.current.from
          if (target > 0) v.currentTime = Math.min(target, v.duration || target)
        }}
        onDurationChange={(e) =>
          onDuration(clipLen(e.currentTarget.duration || 0, winRef.current))
        }
        onTimeUpdate={tick}
        onSeeked={tick}
        onPlay={() => {
          onPlayingChange(true)
          setPlaying(true)
        }}
        onPlaying={() => setBuffering(false)}
        onWaiting={() => setBuffering(true)}
        onPause={() => {
          onPlayingChange(false)
          setPlaying(false)
          setBuffering(false)
        }}
        onEnded={() => {
          onPlayingChange(false)
          setPlaying(false)
          setBuffering(false)
        }}
        onError={() => {
          setFailed(true)
          setReady(false)
          setBuffering(false)
          setPlaying(false)
          onPlayingChange(false)
        }}
      />
      {failed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-inset px-6 text-center">
          <TriangleAlert size={22} className="text-danger" />
          <p className="text-[13px] font-semibold text-fg-strong">
            The downloaded copy wouldn’t play
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted">
            It may have aged out of storage. You can switch back to the YouTube
            player, or download it again.
          </p>
          {onFallback && (
            <button type="button" onClick={onFallback} className="btn-ghost btn-sm press mt-1">
              Back to YouTube
            </button>
          )}
        </div>
      ) : playing ? (
        <div className="absolute inset-0" onClick={() => videoRef.current?.pause()} />
      ) : !ready || buffering ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-inset"
          aria-label="Loading video"
          aria-busy="true"
        >
          <Loader2 size={44} className="animate-spin text-accentink" />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setBuffering(true)
            void videoRef.current?.play().catch(() => setBuffering(false))
          }}
          aria-label="Play video"
          className="group/play absolute inset-0 grid place-items-center"
        >
          <span
            className="grid h-[68px] w-[68px] place-items-center rounded-full bg-accent transition-transform duration-200 ease-instr group-hover/play:scale-105"
            style={{ boxShadow: '0 8px 28px rgb(0 0 0 / 0.55)' }}
          >
            <Play
              size={28}
              strokeWidth={0}
              className="translate-x-[1.5px] fill-current text-onaccent"
            />
          </span>
        </button>
      )}
      {score}
      {overlay}
    </div>
  )
})

export default LocalVideoPlayer
