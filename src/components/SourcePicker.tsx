import { useRef, useState } from 'react'
import { Play, FileAudio } from 'lucide-react'
import TitleBar from './TitleBar'

interface Props {
  /** A song-structure board loads the same way; only the promise differs. */
  isStructure?: boolean
  /** Commits the source. Returns false when the link carries no video id, so
   *  the failure reports here instead of in a modal. */
  onYoutube: (url: string) => boolean
  onAudioFile: (file: File) => void
}

/**
 * The empty deck: what a track shows until it has a recording. It stands where
 * the player will stand — same title bar, same inset screen — so loading a
 * source swaps the controls for the player without the layout moving. The
 * whole screen takes the drop; the URL field takes focus, because the way in
 * is almost always a pasted YouTube link.
 */
export default function SourcePicker({
  isStructure = false,
  onYoutube,
  onAudioFile,
}: Props) {
  const [url, setUrl] = useState('')
  const [over, setOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // dragenter/leave fire for every child the pointer crosses; depth-count them
  // so the highlight doesn't strobe as it passes over the form.
  const dragDepth = useRef(0)

  const take = (file?: File | null) => {
    if (!file) return
    if (!file.type.startsWith('audio/')) {
      setError(`“${file.name}” isn’t an audio file. Try MP3, WAV, or M4A.`)
      return
    }
    setError(null)
    onAudioFile(file)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const value = url.trim()
    if (!value) return
    if (onYoutube(value)) setError(null)
    else
      setError(
        'No video id in that link. Copy the URL straight from YouTube’s address bar.',
      )
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current += 1
        if (e.dataTransfer.types.includes('Files')) setOver(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current -= 1
        if (dragDepth.current <= 0) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setOver(false)
        take(e.dataTransfer.files?.[0])
      }}
    >
      <TitleBar left="Player" right="No source" />
      <div className="bevel-inset relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-inset px-6 py-8">
        {/* Drop highlight — the sanctioned signal use for drag-and-drop. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 border-2 bg-accent/10 transition-opacity duration-150 ${
            over ? 'border-accent opacity-100' : 'border-transparent opacity-0'
          }`}
        />

        <div className="relative w-full max-w-md">
          <h2 className="text-[15px] font-semibold tracking-[0.01em] text-fg">
            {over ? 'Drop to load' : 'Load a recording'}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
            {isStructure
              ? 'Paste a YouTube link, or open an audio file. You map its sections once it plays.'
              : 'Paste a YouTube link, or open an audio file. Notes anchor to the moments you mark.'}
          </p>

          <form onSubmit={submit} className="mt-5 flex gap-2">
            <input
              /* The path in is almost always a link already on the clipboard. */
              autoFocus
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                if (error) setError(null)
              }}
              aria-label="YouTube link"
              aria-invalid={!!error}
              placeholder="https://www.youtube.com/watch?v=…"
              /* No focus:outline-none here — it would outrank the global
                 :focus-visible ring in index.css and strip the keyboard cue. */
              className="bevel-inset min-w-0 flex-1 rounded border border-line bg-inset px-3 py-2 text-sm text-fg transition-colors placeholder:text-muted focus:border-accent"
            />
            <button
              type="submit"
              disabled={!url.trim()}
              className="press bevel-raised inline-flex shrink-0 items-center gap-1.5 rounded bg-accent px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-onaccent transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              <Play size={13} fill="currentColor" /> Load
            </button>
          </form>

          <div className="mt-5 flex items-center gap-3 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <div className="mt-5 flex items-center gap-3">
            <label className="press inline-flex shrink-0 cursor-pointer items-center gap-2 rounded border border-line bg-transparent px-3 py-2 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-fg">
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  take(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <FileAudio size={14} /> Open an audio file
            </label>
            {/* The accepted formats, silkscreened like a panel spec. */}
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
              MP3 · WAV · M4A
            </span>
          </div>
          <p className="mt-2.5 text-[12px] text-muted">
            …or drag one straight onto this screen.
          </p>

          {/* Reserve the row so a failure doesn't shove the form upward. */}
          <p
            role="alert"
            aria-live="polite"
            className={`mt-4 min-h-[1.25rem] text-[12.5px] leading-snug text-danger transition-opacity duration-150 ${
              error ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {error}
          </p>
        </div>
      </div>
    </div>
  )
}
