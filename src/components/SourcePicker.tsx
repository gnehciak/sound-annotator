import { useState } from 'react'
import { Play, FileAudio } from 'lucide-react'

interface Props {
  onYoutube: (url: string) => void
  onAudioFile: (file: File) => void
}

export default function SourcePicker({ onYoutube, onAudioFile }: Props) {
  const [url, setUrl] = useState('')
  const [over, setOver] = useState(false)

  const take = (file?: File | null) => {
    if (file && file.type.startsWith('audio/')) onAudioFile(file)
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 rounded border border-line bg-panel p-6">
      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Load from YouTube
        </h2>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim()) onYoutube(url.trim())
          }}
        >
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            className="flex-1 rounded border border-line bg-inset px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-accent hover:bg-accent/20"
          >
            <Play size={14} /> Load
          </button>
        </form>
      </div>

      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Open an audio file
        </h2>
        <p className="mt-1 text-xs text-muted">
          MP3, WAV, M4A… Plays as a waveform you can click through, and syncs to
          your account so it's there next time.
        </p>
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            take(e.dataTransfer.files?.[0])
          }}
          className={`mt-2 flex cursor-pointer items-center justify-center gap-2 rounded border-2 border-dashed px-4 py-6 text-sm ${
            over
              ? 'border-accent bg-accent/5 text-accent'
              : 'border-line text-muted hover:border-accent hover:text-accent'
          }`}
        >
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              take(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <FileAudio size={18} />{' '}
          {over ? 'Drop to open' : 'Click or drag an audio file here'}
        </label>
      </div>
    </div>
  )
}
