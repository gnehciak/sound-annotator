// The section footer's ⤓ key: a popover that says what is about to be
// downloaded before it is — the span and its length, which stems (or the full
// mix), and a play button that previews exactly that cut. Preview and download
// fetch the same bytes from the clip route (lib/clipDownload), so a cut that
// has been previewed downloads instantly from the copy already in hand.
import { useEffect, useRef, useState } from 'react'
import { Check, Download, Loader2, Pause, Play } from 'lucide-react'
import Popover from '../Popover'
import { downloadClip, fetchClip } from '../../lib/clipDownload'
import { formatTime } from '../../lib/format'
import { STEM_ORDER } from '../../lib/stems'

interface Props {
  project: { id: string; title: string }
  start: number
  end: number
  /** Stems this track can cut; empty hides the stem row. */
  stems: string[]
  /** The picks the popover opens with — the mixer's soloed parts. */
  initialStems?: string[]
}

export default function ClipDownloadButton({
  project,
  start,
  end,
  stems,
  initialStems = [],
}: Props) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const names = STEM_ORDER.filter((n) => stems.includes(n))
  const [picked, setPicked] = useState<string[]>(initialStems)
  const chosen = names.filter((n) => picked.includes(n))
  const cutKey = chosen.join('+')
  // The choice right now, for a fetch that lands after it changed.
  const keyRef = useRef(cutKey)
  useEffect(() => {
    keyRef.current = cutKey
  }, [cutKey])

  // One fetched cut per stem choice, kept while the popover lives, so
  // toggling back to a choice already heard costs nothing.
  const cache = useRef(new Map<string, Blob>())
  const audio = useRef<HTMLAudioElement | null>(null)
  const ring = useRef<SVGCircleElement>(null)
  const [busy, setBusy] = useState<'preview' | 'download' | null>(null)
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stopPreview = () => {
    const a = audio.current
    if (a) {
      a.pause()
      URL.revokeObjectURL(a.src)
    }
    audio.current = null
    setPlaying(false)
    if (ring.current) ring.current.style.strokeDashoffset = '1'
  }
  // A new choice is a new cut; closing the popover silences it.
  useEffect(() => stopPreview, [cutKey, open])

  // The ring follows the preview by frame, written straight to the element.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const a = audio.current
      if (a && ring.current && a.duration > 0)
        ring.current.style.strokeDashoffset = String(1 - a.currentTime / a.duration)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  async function cut(): Promise<Blob> {
    const have = cache.current.get(cutKey)
    if (have) return have
    const blob = await fetchClip(project.id, { start, end }, chosen)
    cache.current.set(cutKey, blob)
    return blob
  }

  async function togglePreview() {
    if (busy) return
    const a = audio.current
    if (a) {
      if (a.paused) void a.play()
      else a.pause()
      return
    }
    setBusy('preview')
    setError(null)
    const forKey = cutKey
    try {
      const blob = await cut()
      if (forKey !== keyRef.current) return
      const el = new Audio(URL.createObjectURL(blob))
      el.onplay = () => setPlaying(true)
      el.onpause = () => setPlaying(false)
      el.onended = stopPreview
      audio.current = el
      void el.play()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The clip could not be made.')
    } finally {
      setBusy(null)
    }
  }

  async function download() {
    if (busy) return
    setBusy('download')
    setError(null)
    try {
      await downloadClip(project, { start, end }, { stems: chosen, blob: await cut() })
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The clip could not be made.')
    } finally {
      setBusy(null)
    }
  }

  const length = Math.max(0, end - start)
  const toggle = (n: string) =>
    setPicked((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]))

  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Download this section's audio as an m4a clip"
        aria-label="Download this section as an audio clip"
        className="btn-icon press"
      >
        <Download size={13} />
      </button>
      <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} width={280} className="p-3">
        <div className="flex flex-col gap-3 text-[12px]">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void togglePreview()}
              title={playing ? 'Pause the preview' : 'Preview this clip'}
              aria-label={playing ? 'Pause the preview' : 'Preview this clip'}
              className="press relative grid h-14 w-14 shrink-0 place-items-center rounded-full text-[rgb(var(--on-accent))]"
            >
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
                <circle cx="50" cy="50" r="47" fill="rgb(var(--accent))" />
                <circle
                  ref={ring}
                  cx="50"
                  cy="50"
                  r="47"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity={0.55}
                  strokeWidth={5}
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1}
                  strokeLinecap="round"
                />
              </svg>
              <span className="relative">
                {busy === 'preview' ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : playing ? (
                  <Pause size={20} fill="currentColor" strokeWidth={0} />
                ) : (
                  <Play size={20} fill="currentColor" strokeWidth={0} className="ml-0.5" />
                )}
              </span>
            </button>
            <div className="flex flex-col gap-0.5">
              <p className="font-mono text-[13px] tabular-nums text-fg-strong">
                {formatTime(start)} – {formatTime(end)}
              </p>
              <p className="font-mono text-[11px] tabular-nums text-muted">
                {length < 60 ? `${Math.round(length)} s` : formatTime(length)} · m4a
              </p>
            </div>
          </div>

          {names.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted">
                Stems {chosen.length === 0 && '· full mix'}
              </span>
              <div className="flex flex-wrap gap-1">
                {names.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={picked.includes(n)}
                    onClick={() => toggle(n)}
                    className={`chip press capitalize ${
                      picked.includes(n) ? 'chip-signal' : 'chip-outline'
                    }`}
                  >
                    {picked.includes(n) && <Check size={11} strokeWidth={3} aria-hidden />}
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-danger">{error}</p>}

          <button
            type="button"
            onClick={() => void download()}
            disabled={busy === 'download'}
            className="btn-signal press justify-center"
          >
            {busy === 'download' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {busy === 'download' ? 'Cutting…' : 'Download clip'}
          </button>
        </div>
      </Popover>
    </>
  )
}
