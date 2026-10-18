// `?embed=` — one passage of a track as a square with a play/pause button in
// it, for an iframe on another page (see lib/embed.ts). Nothing else: no
// title, no scrubber, no sign-in.
//
// The audio is the clip export's m4a, fetched as a blob on the first press
// rather than handed to <audio src> — the clip route doesn't answer Range
// requests, which Safari demands of a media URL, and a blob plays everywhere.
// Lazily, too: each fetch is a server-side cut, so a page that merely shows
// the button costs nothing until someone presses it. Once fetched it is kept,
// so pressing again replays without another cut.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'

interface Props {
  id: string
  start: number
  end: number
  stems: string[]
}

type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

export default function EmbedPlayer({ id, start, end, stems }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'Audio clip'
    document.documentElement.style.background = 'transparent'
    return () => {
      const a = audioRef.current
      if (a) {
        a.pause()
        URL.revokeObjectURL(a.src)
      }
    }
  }, [])

  // The ring follows the audio by frame while it plays, writing the stroke
  // straight onto the element so nothing re-renders.
  useEffect(() => {
    if (status !== 'playing') return
    let raf = 0
    const tick = () => {
      const a = audioRef.current
      const ring = ringRef.current
      if (a && ring && a.duration > 0) ring.style.strokeDashoffset = String(1 - a.currentTime / a.duration)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [status])

  async function load(): Promise<HTMLAudioElement | null> {
    setStatus('loading')
    const q = new URLSearchParams({ start: String(start), end: String(end) })
    for (const s of stems) q.append('stem', s)
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(id)}/clip?${q}`)
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d: { error?: string }) => d.error)
          .catch(() => null)
        throw new Error(res.status === 403 ? 'This track isn’t shared' : msg || 'Couldn’t load the clip')
      }
      const a = new Audio(URL.createObjectURL(await res.blob()))
      a.onplay = () => setStatus('playing')
      a.onpause = () => setStatus('paused')
      a.onended = () => {
        setStatus('idle')
        if (ringRef.current) ringRef.current.style.strokeDashoffset = '1'
      }
      audioRef.current = a
      return a
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t load the clip')
      setStatus('error')
      return null
    }
  }

  async function toggle() {
    if (status === 'loading') return
    const a = audioRef.current ?? (await load())
    if (!a) return
    if (a.paused) a.play().catch(() => setStatus('paused'))
    else a.pause()
  }

  const playing = status === 'playing'
  const label =
    status === 'error' ? error : status === 'loading' ? 'Loading…' : playing ? 'Pause' : 'Play'

  return (
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-ink">
      <button
        type="button"
        onClick={() => {
          if (status === 'error') {
            setError('')
            setStatus('idle')
          }
          void toggle()
        }}
        title={label}
        aria-label={label}
        className="press relative grid aspect-square w-[62vmin] place-items-center rounded-full text-[rgb(var(--on-accent))]"
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="50" cy="50" r="47" fill="rgb(var(--accent))" />
          <circle
            ref={ringRef}
            cx="50"
            cy="50"
            r="47"
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.55}
            strokeWidth={4}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1}
            strokeLinecap="round"
          />
        </svg>
        <span className="relative">
          {status === 'loading' ? (
            <Loader2 className="h-[24vmin] w-[24vmin] animate-spin" />
          ) : playing ? (
            <Pause className="h-[24vmin] w-[24vmin]" fill="currentColor" strokeWidth={0} />
          ) : (
            <Play className="ml-[3vmin] h-[24vmin] w-[24vmin]" fill="currentColor" strokeWidth={0} />
          )}
        </span>
      </button>
      {status === 'error' && (
        <p className="absolute inset-x-2 bottom-[4vmin] text-center text-[max(10px,5vmin)] text-muted">
          {error}
        </p>
      )}
    </div>
  )
}
