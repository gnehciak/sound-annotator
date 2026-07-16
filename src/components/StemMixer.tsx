import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { AudioLines, X } from 'lucide-react'
import type { PlayerHandle } from '../types'

// Display order for whichever of the six Demucs stems the analysis saved.
const STEM_ORDER = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']

// Sync cadence and the drift beyond which a stem is snapped to the player.
// Loose enough that normal timeupdate jitter never causes an audible skip,
// tight enough that a seek (or a YouTube ad) re-aligns within half a second.
const SYNC_MS = 400
const MAX_DRIFT_S = 0.3

interface Props {
  /** Stem name → Blob URL (from Project.stems). */
  stems: Record<string, string>
  /** The main player — the clock the stems follow. */
  playerRef: RefObject<PlayerHandle | null>
  isPlaying: boolean
  /** Effective volume (0 while muted); stems track the volume slider. */
  volume: number
  playbackRate: number
  /** Fires with whether any stem is audible — the parent mutes the main
   *  player while true. */
  onActiveChange: (active: boolean) => void
}

/**
 * The stem mixer: isolate the separated parts (vocals/drums/bass/…) that
 * section detection saved for this track. Toggling any stem on silences the
 * main player and plays the chosen stems instead, slaved to the main player's
 * clock — the transport, waveform, overview and notes all keep working, only
 * the sound source changes. Toggling everything off (or ✕) returns the
 * original mix.
 *
 * Each stem is an HTMLAudioElement streaming straight from Blob. Every
 * created element plays muted in lockstep so a toggle is instant; a short
 * interval loop corrects drift against the player. Mount with
 * key={projectId} — stems must not leak across tracks.
 */
export default function StemMixer({
  stems,
  playerRef,
  isPlaying,
  volume,
  playbackRate,
  onActiveChange,
}: Props) {
  const [active, setActive] = useState<Set<string>>(new Set())
  const els = useRef<Map<string, HTMLAudioElement>>(new Map())
  // Latest callback, read without re-running the notify effect (mirrors
  // AudioPlayer's cb ref) — an inline onActiveChange must not retrigger it.
  const onActiveRef = useRef(onActiveChange)
  useEffect(() => {
    onActiveRef.current = onActiveChange
  })

  const names = STEM_ORDER.filter((n) => typeof stems[n] === 'string')
  const anyActive = active.size > 0

  // Lazily create an element the first time its stem is switched on (starts
  // the ~stem-sized download, so not before it's wanted).
  const elFor = useCallback(
    (name: string): HTMLAudioElement => {
      let el = els.current.get(name)
      if (!el) {
        el = new Audio(stems[name])
        el.preload = 'auto'
        el.muted = true
        els.current.set(name, el)
      }
      return el
    },
    [stems],
  )

  function toggle(name: string) {
    elFor(name)
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const clear = () => setActive(new Set())

  // Tell the parent when the sound source changes hands.
  useEffect(() => {
    onActiveRef.current(anyActive)
  }, [anyActive])

  // Mute/unmute per the active set (elements keep playing either way, so a
  // toggle is gapless).
  useEffect(() => {
    els.current.forEach((el, name) => {
      el.muted = !active.has(name)
    })
  }, [active])

  // Transport state: every created element follows the main player.
  useEffect(() => {
    for (const el of els.current.values()) {
      if (isPlaying && anyActive) void el.play().catch(() => {})
      else el.pause()
    }
  }, [isPlaying, anyActive])

  useEffect(() => {
    for (const el of els.current.values()) el.volume = volume
  }, [volume, active])

  useEffect(() => {
    for (const el of els.current.values()) el.playbackRate = playbackRate
  }, [playbackRate, active])

  // The clock: snap any drifted stem to the player's time. Also covers seeks
  // (a seek is just a big drift).
  useEffect(() => {
    if (!anyActive) return
    const iv = setInterval(() => {
      const t = playerRef.current?.getCurrentTime?.()
      if (t == null) return
      for (const el of els.current.values()) {
        if (Math.abs(el.currentTime - t) > MAX_DRIFT_S) el.currentTime = t
      }
    }, SYNC_MS)
    return () => clearInterval(iv)
  }, [anyActive, playerRef])

  // Track change / unmount: stop playback and the downloads behind it.
  useEffect(() => {
    const created = els.current
    return () => {
      for (const el of created.values()) {
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
      created.clear()
    }
  }, [])

  if (names.length === 0) return null

  return (
    <div
      className={`flex shrink-0 flex-wrap items-center gap-1.5 rounded-lg border px-[13px] py-[9px] transition-colors ${
        anyActive ? 'border-accent/50 bg-accent/5' : 'border-line bg-panel'
      }`}
    >
      <span
        className={`mr-1 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] ${
          anyActive ? 'text-accentink' : 'text-muted'
        }`}
        title="Separated by AI section detection — pick parts to hear them isolated"
      >
        <AudioLines size={12} />
        Stems
      </span>
      {names.map((name) => {
        const on = active.has(name)
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            aria-pressed={on}
            title={
              on
                ? `Mute the ${name} stem`
                : `Hear the ${name} stem (silences the original mix)`
            }
            className={`press rounded border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              on
                ? 'border-accent bg-accent text-onaccent'
                : 'border-line text-muted hover:border-line-strong hover:text-fg'
            }`}
          >
            {name}
          </button>
        )
      })}
      {anyActive && (
        <button
          type="button"
          onClick={clear}
          title="Back to the original mix"
          className="press ml-auto inline-flex items-center gap-1 rounded border border-line px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted transition-colors hover:border-line-strong hover:text-fg"
        >
          <X size={11} />
          Original
        </button>
      )}
    </div>
  )
}
