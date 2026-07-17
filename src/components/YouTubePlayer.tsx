import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Loader2, Play } from 'lucide-react'
import type { PlayerHandle } from '../types'
import { loadYouTubeApi } from '../lib/youtube'

interface Props {
  videoId: string
  /**
   * Clip window in seconds of the source video (see ProjectSource.clipStart).
   * This component is the only translator between the two clocks: everything
   * outside it — notes, transport, overview — speaks clip time, where 0 is
   * `clipStart`. Undefined `clipEnd` means "to the end of the video".
   */
  clipStart?: number
  clipEnd?: number
  playbackRate: number
  /** 0–1; mapped to YouTube's 0–100 scale. */
  volume: number
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
}

/**
 * How long the track reads to everyone outside this file: the clip's span,
 * with the video's real duration standing in for an open-ended `to`. Clamped
 * against `videoLen` so a window pointing past the end of the video (a stale
 * clip, a link's bogus `end`) still reports something playable.
 */
const clipLen = (videoLen: number, win: { from: number; to: number }) =>
  Math.max(0, Math.min(win.to, videoLen) - Math.min(win.from, videoLen))

/* eslint-disable @typescript-eslint/no-explicit-any */
const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  {
    videoId,
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
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  // Clip time (0 = clipStart), like every other time in the app.
  const timeRef = useRef(0)
  const playingRef = useRef(false)
  const from = Math.max(0, clipStart ?? 0)
  // The window's edges, read from inside the poll/onReady closures so they
  // stay current without another remount. `to` is Infinity until we know the
  // video's real duration, which arrives with onReady.
  const winRef = useRef({ from, to: clipEnd ?? Infinity })
  winRef.current = { from, to: clipEnd ?? Infinity }
  // Read inside the (videoId-keyed) onReady closure so a remount picks up the
  // current rate without re-creating the player on every speed change.
  const rateRef = useRef(playbackRate)
  rateRef.current = playbackRate
  // Same idea for volume: the onReady closure applies whatever level is current
  // when the (re)mounted player becomes ready.
  const volRef = useRef(volume)
  volRef.current = volume
  // Until the video has started once, we cover it to hide YouTube's poster
  // (title, avatar, share / watch-later buttons, big play button).
  const [started, setStarted] = useState(false)
  // The iframe API + player are still initializing (no playVideo yet).
  const [ready, setReady] = useState(false)
  // A play has been requested but the video hasn't begun (still buffering).
  const [buffering, setBuffering] = useState(false)
  // Mirrors playingRef as state so the overlay can come back on pause.
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setStarted(false)
    setReady(false)
    setBuffering(false)
    setPlaying(false)
    playingRef.current = false
    let cancelled = false
    let poll: number | undefined
    // YT replaces its target node with an <iframe>; give it a throwaway child
    // so React never tries to manage a node that's been swapped out.
    const host = document.createElement('div')
    host.style.width = '100%'
    host.style.height = '100%'
    containerRef.current?.appendChild(host)

    loadYouTubeApi().then((YT: any) => {
      if (cancelled) return
      playerRef.current = new YT.Player(host, {
        videoId,
        // Privacy-enhanced embed host: the player runs without the viewer's
        // signed-in YouTube session (no cookies from youtube.com). Besides
        // being the right default for a classroom, it stops YouTube pausing
        // our embed with "your account is being used on another device"
        // whenever the teacher's account streams elsewhere.
        host: 'https://www.youtube-nocookie.com',
        // controls: 0 hides YouTube's own control bar (we have our own transport)
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          // Cue the clip's first frame, so the poster we uncover on pause is
          // the excerpt rather than the video's opening titles. `start` only
          // seeds the initial position — the window is enforced below, since a
          // seek can leave it at any time.
          ...(winRef.current.from ? { start: Math.floor(winRef.current.from) } : {}),
        },
        events: {
          onReady: (e: any) => {
            setReady(true)
            onDuration(clipLen(e.target.getDuration() || 0, winRef.current))
            e.target.setPlaybackRate?.(rateRef.current)
            // Autoplay policies can start the player muted — unmute (unless we
            // want silence) so our volume level actually takes effect.
            if (volRef.current > 0) e.target.unMute?.()
            e.target.setVolume?.(Math.round(volRef.current * 100))
          },
          onStateChange: (e: any) => {
            // 1 = playing, 2 = paused, 0 = ended, 3 = buffering. Ignore 3 for
            // the play/pause button so a seek while playing doesn't flip it to
            // "Play" for ~0.5s; it does drive the pre-start loading overlay.
            if (e.data === 1) {
              onPlayingChange(true)
              playingRef.current = true
              setPlaying(true)
              setStarted(true)
              setBuffering(false)
            } else if (e.data === 3) {
              setBuffering(true)
            } else if (e.data === 2 || e.data === 0) {
              onPlayingChange(false)
              playingRef.current = false
              setPlaying(false)
              setBuffering(false)
            }
            const d = e.target.getDuration?.() || 0
            if (d) onDuration(clipLen(d, winRef.current))
          },
        },
      })
      poll = window.setInterval(() => {
        const p = playerRef.current
        if (!p?.getCurrentTime) return
        const { from, to } = winRef.current
        const raw = p.getCurrentTime()
        // Playing out of the clip's end stops the track, exactly as reaching a
        // whole video's end would. Ticks are coarse (250ms), so snap the
        // playhead back onto the edge rather than leave it a beat past.
        if (playingRef.current && raw >= to) {
          p.pauseVideo?.()
          p.seekTo?.(to, true)
          timeRef.current = to - from
          onTime(timeRef.current)
          return
        }
        timeRef.current = Math.max(0, raw - from)
        onTime(timeRef.current)
      }, 250)
    })

    return () => {
      cancelled = true
      if (poll) clearInterval(poll)
      try {
        playerRef.current?.destroy?.()
      } catch {
        /* ignore */
      }
      playerRef.current = null
      host.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId])

  // Apply live speed changes (onReady handles the initial / post-remount rate).
  useEffect(() => {
    playerRef.current?.setPlaybackRate?.(playbackRate)
  }, [playbackRate])

  // Apply live volume changes (onReady handles the initial / post-remount level).
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    if (volume > 0) p.unMute?.()
    p.setVolume?.(Math.round(volume * 100))
  }, [volume])

  // A clip edit doesn't remount the player (winRef already carries the new
  // edges): re-report the length, and pull the playhead back inside if the
  // window moved out from under it.
  useEffect(() => {
    const p = playerRef.current
    if (!p?.getDuration) return
    const { from, to } = winRef.current
    onDuration(clipLen(p.getDuration() || 0, winRef.current))
    const raw = p.getCurrentTime?.() ?? 0
    if (raw < from || raw > to) p.seekTo?.(Math.min(Math.max(raw, from), to), true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, clipEnd])

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.playVideo?.(),
      pause: () => playerRef.current?.pauseVideo?.(),
      // Callers hand us clip time; YouTube only ever hears video time.
      seekTo: (s: number) => {
        const { from, to } = winRef.current
        playerRef.current?.seekTo?.(Math.min(Math.max(from + s, from), to), true)
      },
      getCurrentTime: () => timeRef.current,
    }),
    [],
  )

  return (
    // Cap the video height (keeping 16:9 + centred) so a wide player column
    // doesn't squeeze the overview rail below it. Width tracks the height cap:
    // min(100%, cap·16/9) ⇒ height ≤ cap. The cap is `--player-max-h`, which the
    // app drives from the resize handle under the transport; it defaults to 50vh.
    <div
      className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg border border-line bg-black"
      style={{ maxWidth: 'calc(var(--player-max-h, 50vh) * 16 / 9)' }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {playing ? (
        // Tape is rolling: a transparent click-catcher blocks YouTube's hover
        // title bar while letting a click pass through to our transport (pause).
        <div
          className="absolute inset-0"
          title="Click to pause"
          onClick={() => playerRef.current?.pauseVideo?.()}
        />
      ) : !ready || buffering ? (
        // Player still initializing, or buffering after a play press: cover the
        // poster and show a loading spinner instead of the play button.
        <div
          className="absolute inset-0 flex items-center justify-center bg-inset"
          aria-label="Loading video"
          aria-busy="true"
        >
          <Loader2 size={44} className="animate-spin text-accentink" />
        </div>
      ) : (
        // Paused: just the play/pause circle. Before the video has ever started
        // we cover with bg-inset to hide YouTube's pre-play poster chrome
        // (title, share, "Watch on YouTube"); after it's started, the overlay
        // goes transparent so the paused frame stays visible behind the circle.
        <button
          type="button"
          onClick={() => {
            setBuffering(true)
            playerRef.current?.playVideo?.()
          }}
          aria-label={started ? 'Resume video' : 'Play video'}
          className={`group/play absolute inset-0 grid place-items-center ${started ? '' : 'bg-inset'}`}
        >
          <span
            className="grid h-[68px] w-[68px] place-items-center rounded-full bg-accent transition-transform duration-200 ease-instr group-hover/play:scale-105"
            style={{ boxShadow: '0 8px 28px rgb(0 0 0 / 0.55)' }}
          >
            <Play
              size={28}
              strokeWidth={0}
              // Lucide's triangle points (6 3, 20 12, 6 21) put its centroid
              // ~1.33 viewBox units left of centre; at size=28 that's a ~1.5px
              // nudge to the right to make the triangle read as visually centred.
              className="translate-x-[1.5px] fill-current text-onaccent"
            />
          </span>
        </button>
      )}
    </div>
  )
})

export default YouTubePlayer
