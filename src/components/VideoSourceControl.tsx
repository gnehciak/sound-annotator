import { useRef, useState } from 'react'
import { Check, Download, Loader2 } from 'lucide-react'
import Popover from './Popover'
import {
  downloadLabel,
  VIDEO_QUALITIES,
  type LocalVideo,
  type VideoQuality,
} from '../lib/videoDownload'

interface Props {
  /** The track's downloaded-copy state (useLocalVideo). */
  local: LocalVideo
  /** May the viewer spend a download — the owner or an admin. */
  canDownload: boolean
}

/**
 * The player title bar's "download the video and play the downloaded copy"
 * control, shown only on a YouTube track.
 *
 * Three states in one slot. With a copy stored, a YouTube / Downloaded toggle
 * (the reader's own choice, session state). While a download is in flight, its
 * progress. Otherwise, for the owner, a Download button with a quality menu —
 * everyone else just sees nothing to press, since only the owner can spend the
 * bandwidth on their own track.
 */
export default function VideoSourceControl({ local, canDownload }: Props) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)

  if (local.available) {
    return (
      <div className="seg shrink-0" role="group" aria-label="Video source">
        <button
          type="button"
          className="seg-item press"
          aria-pressed={!local.preferLocal}
          onClick={() => local.setPreferLocal(false)}
          title="Play the YouTube embed"
        >
          YouTube
        </button>
        <button
          type="button"
          className="seg-item press"
          aria-pressed={local.preferLocal}
          onClick={() => local.setPreferLocal(true)}
          title="Play the downloaded copy"
        >
          Downloaded
        </button>
      </div>
    )
  }

  if (local.downloading) {
    return (
      <span
        className="btn-ghost btn-sm shrink-0 cursor-default gap-1.5 opacity-80"
        aria-busy="true"
      >
        <Loader2 size={12} className="animate-spin" />
        {downloadLabel(local.progress)}
      </span>
    )
  }

  if (!canDownload) return null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setMenu((v) => !v)}
        title={local.error ?? 'Download this video to play the copy'}
        className="btn-ghost btn-sm press shrink-0"
      >
        <Download size={12} />
        {local.error ? 'Retry download' : 'Download'}
      </button>
      <Popover open={menu} anchorRef={btnRef} onClose={() => setMenu(false)} width={176}>
        <div className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted">
          Download quality
        </div>
        {VIDEO_QUALITIES.map((q) => (
          <button
            key={String(q.value)}
            type="button"
            className="pop-row press"
            onClick={() => {
              setMenu(false)
              local.start(q.value as VideoQuality)
            }}
          >
            <span className="flex-1 text-left">{q.label}</span>
            {q.value === 720 && <Check size={13} className="text-muted" aria-hidden />}
          </button>
        ))}
      </Popover>
    </>
  )
}
