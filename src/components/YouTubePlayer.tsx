import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Play } from 'lucide-react'
import type { PlayerHandle } from '../types'
import { loadYouTubeApi } from '../lib/youtube'

interface Props {
  videoId: string
  onTime: (t: number) => void
  onDuration: (d: number) => void
  onPlayingChange: (playing: boolean) => void
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const YouTubePlayer = forwardRef<PlayerHandle, Props>(function YouTubePlayer(
  { videoId, onTime, onDuration, onPlayingChange },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<any>(null)
  const timeRef = useRef(0)
  const playingRef = useRef(false)
  // Until the video has started once, we cover it to hide YouTube's poster
  // (title, avatar, share / watch-later buttons, big play button).
  const [started, setStarted] = useState(false)

  useEffect(() => {
    setStarted(false)
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
          onReady: (e: any) => onDuration(e.target.getDuration() || 0),
          onStateChange: (e: any) => {
            // 1 = playing, 2 = paused, 0 = ended. Ignore 3 (buffering) so a
            // seek while playing doesn't flip the button to "Play" for ~0.5s.
            if (e.data === 1) {
              onPlayingChange(true)
              playingRef.current = true
              setStarted(true)
            } else if (e.data === 2 || e.data === 0) {
              onPlayingChange(false)
              playingRef.current = false
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
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
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
      ) : (
        // Opaque cover hiding YouTube's poster until the first play.
        <button
          type="button"
          onClick={() => playerRef.current?.playVideo?.()}
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
