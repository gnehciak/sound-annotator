import { useState } from 'react'
import { Play } from 'lucide-react'

/**
 * Point a track at an audio file that already lives somewhere on the web.
 *
 * The caveat in the copy is the whole reason this form needs explaining:
 * wavesurfer fetches and decodes the bytes to draw the waveform (see
 * AudioPlayer), so the host has to allow cross-origin reads. A Google Drive or
 * Dropbox *share page* isn't a file URL and won't work; plenty of servers that
 * do serve the file still refuse the read. When that happens the browser's own
 * error is a CORS message nobody outside this file would connect to the link
 * they pasted — so say it up front, before they paste.
 */
export default function AudioUrlForm({
  onAudioUrl,
  compact = false,
}: {
  onAudioUrl: (url: string) => void
  compact?: boolean
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  // Only a nudge: plenty of legitimate direct links carry no extension (signed
  // URLs, CDN paths), so this never blocks the submit.
  const looksLikeSharePage =
    /drive\.google\.com|dropbox\.com\/s\/|onedrive\.live\.com|1drv\.ms/i.test(
      trimmed,
    )

  return (
    <div>
      {!compact && (
        <>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted">
            Link to an audio file
          </h2>
          <p className="mt-1 text-xs text-muted">
            A direct link to an MP3, WAV or M4A — one that plays the file
            itself, not a Drive or Dropbox share page. The host also has to
            allow other sites to read it, so a link that works in your browser
            may still not load here.
          </p>
        </>
      )}
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onAudioUrl(trimmed)
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://example.com/track.mp3"
          className="flex-1 rounded border border-line bg-inset px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded border border-accent/70 bg-accent/10 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-accentink hover:bg-accent/20"
        >
          <Play size={14} /> Load
        </button>
      </form>
      {looksLikeSharePage && (
        <p className="mt-2 font-mono text-[11px] text-peak">
          That looks like a share page, not a direct file link — it almost
          certainly won't play.
        </p>
      )}
    </div>
  )
}
