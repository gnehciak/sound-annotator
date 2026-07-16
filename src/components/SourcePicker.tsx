import { useState } from 'react'
import { Play } from 'lucide-react'
import AudioUrlForm from './AudioUrlForm'

interface Props {
  onYoutube: (url: string) => void
  onAudioUrl: (url: string) => void
}

/**
 * The two ways a track gets its sound: a YouTube link, or a direct link to an
 * audio file. Uploading was removed deliberately — nothing here writes to
 * storage, so both options cost the same (nothing), which is why guests get
 * both.
 */
export default function SourcePicker({ onYoutube, onAudioUrl }: Props) {
  const [url, setUrl] = useState('')

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
            className="inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accentink hover:bg-accent/20"
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

      <AudioUrlForm onAudioUrl={onAudioUrl} />
    </div>
  )
}
