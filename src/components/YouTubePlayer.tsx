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
  playbackRate: number
  /** 0–1; mapped to YouTube's 0–100 scale. */
  volume: number
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { videoId, playbackRate, volume, onTime, onDuration, onPlayingChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const timeRef = useRef(0)
  const playingRef = useRef(false)
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

  useEffect(() => {
    setStarted(false)
    setReady(false)
    setBuffering(false)
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
        // controls: 0 hides YouTube's own control bar (we have our own transport)
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
        },
        events: {
          onReady: (e: any) => {
            setReady(true)
            onDuration(e.target.getDuration() || 0)
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
              setStarted(true)
              setBuffering(false)
            } else if (e.data === 3) {
              setBuffering(true)
            } else if (e.data === 2 || e.data === 0) {
              onPlayingChange(false)
              playingRef.current = false
              setBuffering(false)
            }
            const d = e.target.getDuration?.() || 0
            if (d) onDuration(d)
          },
        },
      })
      poll = window.setInterval(() => {
        const p = playerRef.current
        if (p?.getCurrentTime) {
          const t = p.getCurrentTime()
          timeRef.current = t
          onTime(t)
        }
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

  useImperativeHandle(
    ref,
    () => ({
      play: () => playerRef.current?.playVideo?.(),
      pause: () => playerRef.current?.pauseVideo?.(),
      seekTo: (s: number) => playerRef.current?.seekTo?.(s, true),
      getCurrentTime: () => timeRef.current,
    }),
    [],
  )

  return (
    // Cap the video at 50vh tall (keeping 16:9 + centred) so a wide player
    // column doesn't squeeze the overview rail below it. Width tracks the
    // height cap: min(100%, 50vh·16/9) ⇒ height ≤ 50vh.
    <div
      className="relative mx-auto aspect-video w-full overflow-hidden rounded-lg bg-black"
      style={{ maxWidth: 'calc(50vh * 16 / 9)' }}
    >
      <div ref={containerRef} className="h-full w-full" />
      {started ? (
        // Transparent click-catcher: blocks YouTube's hover title bar and lets
        // clicking the video toggle play/pause through our own transport.
        <div
          className="absolute inset-0"
          title="Click to play / pause"
          onClick={() =>
            playingRef.current
              ? playerRef.current?.pauseVideo?.()
              : playerRef.current?.playVideo?.()
          }
        />
      ) : !ready || buffering ? (
        // Player still initializing, or buffering after a play press: cover the
        // poster and show a loading spinner instead of the play button.
        <div
          className="absolute inset-0 flex items-center justify-center bg-ink"
          aria-label="Loading video"
          aria-busy="true"
        >
          <Loader2 size={44} className="animate-spin text-accent" />
        </div>
      ) : (
        // Ready and idle: opaque cover with our play button, hiding YT's poster.
        <button
          type="button"
          onClick={() => {
            setBuffering(true)
            playerRef.current?.playVideo?.()
          }}
          aria-label="Play video"
          className="absolute inset-0 flex items-center justify-center bg-ink transition-colors hover:bg-ink/90"
        >
          <Play size={44} className="fill-current text-accent" />
        </button>
      )}
    </div>
  )
})

export default YouTubePlayer
