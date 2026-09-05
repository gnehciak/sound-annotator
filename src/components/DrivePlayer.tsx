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
import { driveStreamUrl, driveViewUrl } from '../lib/drive'

interface Props {
  /** Floating chrome rendered inside the 16:9 frame, above the picture (the transport). */
  overlay?: ReactNode
  /** Google Drive file id (see lib/drive.ts). */
  fileId: string
  /**
   * Clip window in seconds of the source video (see ProjectSource.clipStart).
   * This component is the only translator between the two clocks: everything
   * outside it — notes, transport, overview — speaks clip time, where 0 is
   * `clipStart`. Undefined `clipEnd` means "to the end of the video".
   */
  clipStart?: number
  clipEnd?: number
  playbackRate: number
  /** 0–1 playback volume, straight onto the media element. */
  volume: number
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
}

/** How long the track reads to everyone outside this file — the clip's span,
 *  with the video's real duration standing in for an open-ended `to`. Mirrors
 *  YouTubePlayer's; same clamping, same reasons. */
const clipLen = (videoLen: number, win: { from: number; to: number }) =>
  Math.max(0, Math.min(win.to, videoLen) - Math.min(win.from, videoLen))

/**
 * A failed load isn't final until this many tries. The proxy only serves file
 * ids a live project already points at, and a just-pasted link reaches the
 * server on the save debounce (~1s) — so the very first load of a new Drive
 * track races the write that authorizes it, and loses. Retrying quietly is
 * what makes the pick feel instant; it also absorbs a transient hiccup on the
 * long way through Drive.
 */
const LOAD_ATTEMPTS = 4
const RETRY_MS = 800

/**
 * The player for a Google Drive video: a plain `<video>` pointed at the file's
 * bytes. Drive's own embed is an iframe with no scriptable clock, which an
 * annotation app can't use — lib/drive.ts has the full reasoning, including
 * why the file has to be link-shared for any of this to load.
 *
 * The chrome deliberately matches YouTubePlayer's — same 16:9 frame, same
 * play circle, same spinner — so the two source kinds feel like one player
 * with two inputs. The one thing it adds is a real failure state: a Drive
 * video that isn't shared fails silently at the network layer, and the only
 * person who can fix that is the teacher holding the file.
 */
const DrivePlayer = forwardRef<PlayerHandle, Props>(function DrivePlayer(
  {
    overlay,
    fileId,
    clipStart,
    clipEnd,
    playbackRate,
    volume,
    onTime,
    onDuration,
    onPlayingChange,
  },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // Clip time (0 = clipStart), like every other time in the app.
  const timeRef = useRef(0)
  const from = Math.max(0, clipStart ?? 0)
  // The window's edges, read from inside the event handlers so a clip edit
  // lands without remounting (and reloading) the video.
  const winRef = useRef({ from, to: clipEnd ?? Infinity })
  winRef.current = { from, to: clipEnd ?? Infinity }
  // Metadata hasn't landed yet, so a seek can't be applied — hold the last one
  // asked for and replay it when the video knows how long it is.
  const pendingSeekRef = useRef<number | null>(null)
  // Load attempts spent on this file, and the pending retry (see LOAD_ATTEMPTS).
  const attemptsRef = useRef(0)
  const retryRef = useRef<number | null>(null)
  const [ready, setReady] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)

  // A new file is a new load: clear the last one's state before its events can
  // be mistaken for this one's.
  useEffect(() => {
    setReady(false)
    setBuffering(false)
    setPlaying(false)
    setFailed(false)
    timeRef.current = 0
    pendingSeekRef.current = null
    attemptsRef.current = 0
    if (retryRef.current != null) window.clearTimeout(retryRef.current)
    retryRef.current = null
  }, [fileId])

  // A retry outliving the player would call load() on a detached element.
  useEffect(
    () => () => {
      if (retryRef.current != null) window.clearTimeout(retryRef.current)
    },
    [],
  )

  // Apply live speed / volume changes. Both also run on mount, which is what
  // seeds the element — there's no onReady equivalent to do it once.
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate
  }, [playbackRate, fileId])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    v.volume = Math.min(1, Math.max(0, volume))
    v.muted = volume <= 0
  }, [volume, fileId])

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
        // Autoplay policy can reject this; the overlay stays on the play
        // circle rather than the transport lying about what's happening.
        void videoRef.current?.play().catch(() => setBuffering(false))
      },
      pause: () => videoRef.current?.pause(),
      // Callers hand us clip time; the media element only ever hears video time.
      seekTo: (s: number) => {
        const { from, to } = winRef.current
        const target = Math.min(Math.max(from + s, from), to)
        const v = videoRef.current
        // Before metadata the element silently drops a seek — remember it.
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

  /** Report the playhead in clip time, stopping the track at the window's end
   *  exactly as reaching a whole video's end would. */
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
    // Same frame as YouTubePlayer: 16:9, centred, height capped by
    // `--player-max-h` so a wide player column doesn't squeeze the overview.
    <div
      className="relative mx-auto aspect-video w-full overflow-hidden rounded-xl border border-line/70 bg-black shadow-[0_24px_50px_-20px_rgb(0_0_0/0.7)]"
      style={{ maxWidth: 'calc(var(--player-max-h, 50vh) * 16 / 9)' }}
    >
      <video
        ref={videoRef}
        key={fileId}
        // Our own origin, not Drive's — Drive answers a browser's cross-site
        // media request 403 no matter how the file is shared (see lib/drive).
        src={driveStreamUrl(fileId)}
        preload="metadata"
        playsInline
        className="h-full w-full"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          setReady(true)
          setFailed(false)
          attemptsRef.current = 0
          v.playbackRate = playbackRate
          v.volume = Math.min(1, Math.max(0, volume))
          v.muted = volume <= 0
          onDuration(clipLen(v.duration || 0, winRef.current))
          const pending = pendingSeekRef.current
          pendingSeekRef.current = null
          // Open on the clip's first frame, so the poster is the excerpt.
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
          // Spend a retry before admitting failure — the spinner stays up, so
          // the race a fresh pick loses never surfaces as a scary panel.
          if (attemptsRef.current < LOAD_ATTEMPTS - 1) {
            attemptsRef.current += 1
            retryRef.current = window.setTimeout(
              () => videoRef.current?.load(),
              RETRY_MS,
            )
            return
          }
          setFailed(true)
          setReady(false)
          setBuffering(false)
          setPlaying(false)
          onPlayingChange(false)
        }}
      />
      {failed ? (
        // By the time this shows, the proxy has been asked several times and
        // Drive has refused each one — and it refuses an unshared file by
        // handing back a sign-in page. Sharing is the one cause the person
        // reading this can fix, so it leads; the rest is honest hedging.
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-inset px-6 text-center">
          <TriangleAlert size={22} className="text-danger" />
          <p className="text-[13px] font-semibold text-fg-strong">
            This Drive video wouldn’t load
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted">
            Drive turned the file down. Check that it’s shared with{' '}
            <span className="text-fg">Anyone with the link</span>, and that the
            link points at a video file rather than a folder.
          </p>
          <a
            href={driveViewUrl(fileId)}
            target="_blank"
            rel="noopener noreferrer"
            className="press mt-1 inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
          >
            Open in Drive
          </a>
        </div>
      ) : playing ? (
        // Tape is rolling: a transparent click-catcher, matching YouTubePlayer,
        // so a click on the picture pauses.
        <div
          className="absolute inset-0"
          title="Click to pause"
          onClick={() => videoRef.current?.pause()}
        />
      ) : !ready || buffering ? (
        <div
          className="absolute inset-0 flex items-center justify-center bg-inset"
          aria-label="Loading video"
          aria-busy="true"
        >
          <Loader2 size={44} className="animate-spin text-accentink" />
        </div>
      ) : (
        // Paused: the play circle over the paused frame. Unlike YouTube there's
        // no poster chrome to hide, so the frame always shows through.
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
              // Same 1.5px nudge as YouTubePlayer — Lucide's triangle centroid
              // sits left of centre.
              className="translate-x-[1.5px] fill-current text-onaccent"
            />
          </span>
        </button>
      )}
      {overlay}
    </div>
  )
})

export default DrivePlayer
