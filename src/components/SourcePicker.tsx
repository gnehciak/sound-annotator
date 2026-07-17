import { useState } from 'react'
import { Play } from 'lucide-react'
import AudioUrlForm from './AudioUrlForm'
import ClipFields from './ClipFields'
import { readClipFields, type ClipDraft } from '../lib/clip'
import { parseClipWindow } from '../lib/youtube'
import { formatTime } from '../lib/format'

interface Props {
  onYoutube: (url: string, clip?: { start?: number; end?: number }) => void
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
  const [clip, setClip] = useState<ClipDraft>({ start: '', end: '' })
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="mx-auto max-w-xl space-y-6 rounded border border-line bg-panel p-6">
      <div>
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
          Load from YouTube
        </h2>
        <form
          className="mt-2 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!url.trim()) return
            const parsed = readClipFields(clip)
            if ('error' in parsed) {
              setError(parsed.error)
              return
            }
            setError(null)
            onYoutube(url.trim(), parsed.clip)
          }}
        >
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => {
                const next = e.target.value
                setUrl(next)
                // A link copied at a moment ("share at current time") already
                // says where to start — offer it rather than make them retype
                // it, but only while the fields are still untouched.
                setClip((c) => {
                  if (c.start || c.end) return c
                  const w = parseClipWindow(next)
                  return w.start == null && w.end == null
                    ? c
                    : { start: secsToField(w.start), end: secsToField(w.end) }
                })
              }}
              placeholder="https://www.youtube.com/watch?v=…"
              className="flex-1 rounded border border-line bg-inset px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accentink hover:bg-accent/20"
            >
              <Play size={14} /> Load
            </button>
          </div>
          <ClipFields
            value={clip}
            onChange={(c) => {
              setClip(c)
              setError(null)
            }}
            error={error}
          />
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

const secsToField = (s: number | undefined) => (s == null ? '' : formatTime(s))
