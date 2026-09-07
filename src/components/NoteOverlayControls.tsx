import { useRef, useState } from 'react'
import { Image as ImageIcon, MapPin, Trash2, Loader2 } from 'lucide-react'
import type { Annotation, NoteOverlay } from '../types'
import { fileToScaledBlob } from '../lib/image'
import {
  HOLD_MAX,
  HOLD_MIN,
  OVERLAY_HOLD,
  clampHold,
  hasCover,
  hasPin,
  hasOverlay,
  patchOverlay,
} from '../lib/overlays'

interface Props {
  annotation: Annotation
  onUpdate: (
    patch: Partial<Annotation>,
    opts?: { mode?: 'text'; coalesceKey?: string },
  ) => void
  /** Uploads a blob and resolves with its public URL (see lib/imageCloud). */
  uploadImage?: (
    blob: Blob,
    onProgress?: (fraction: number) => void,
  ) => Promise<string>
}

/**
 * A cover is shown at full frame, so it's worth more pixels than an inline note
 * image — but not so many that a class on a phone hotspot waits on it.
 */
const COVER_MAX_DIM = 1600

/**
 * The note's stage controls: what it puts on the video while it's on screen —
 * a cover image standing in for the picture, and a pin dropped on the frame
 * that captions itself with the note's own text.
 *
 * Video projects only; the host decides that (an audio track's waveform is the
 * picture and must stay uncovered) and simply doesn't render this.
 */
export default function NoteOverlayControls({
  annotation,
  onUpdate,
  uploadImage,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const overlay: NoteOverlay = annotation.overlay ?? {}
  const busy = progress != null

  const patch = (next: Partial<NoteOverlay>) =>
    onUpdate(patchOverlay(annotation, next))

  const pickCover = async (file: File | undefined) => {
    if (!file || !uploadImage) return
    setError(null)
    setProgress(0)
    try {
      const blob = await fileToScaledBlob(file, COVER_MAX_DIM)
      // The old cover is left in the Blob store on purpose: the image sweep
      // (api/blobs/gc.ts) collects it on the next load, once the *saved* notes
      // no longer name it — so an undo of this replacement still has bytes to
      // come back to.
      patch({ coverUrl: await uploadImage(blob, setProgress) })
    } catch (err) {
      console.error('Cover image upload failed:', err)
      setError("That image couldn't be uploaded — try again.")
    } finally {
      setProgress(null)
    }
  }

  const togglePin = () => {
    // A new pin lands dead centre, where it's impossible to miss; the frame is
    // where it gets aimed (drag the dot).
    patch(
      hasPin(annotation)
        ? { pinX: undefined, pinY: undefined }
        : { pinX: 0.5, pinY: 0.5 },
    )
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line/60 px-[13px] py-2.5">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
        On the video
      </span>

      {/* ---- cover image ---- */}
      {hasCover(annotation) ? (
        <div className="flex items-center gap-2.5 rounded-md border border-line/70 p-2">
          <img
            src={overlay.coverUrl}
            alt="Cover"
            className="h-11 w-[74px] shrink-0 rounded bg-black object-contain"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[11px] text-muted">
              Covers the picture for this note
            </span>
            <div className="seg w-max" role="group" aria-label="How the cover fits the frame">
              {(['contain', 'cover'] as const).map((fit) => (
                <button
                  key={fit}
                  type="button"
                  className="seg-item press"
                  aria-pressed={(overlay.coverFit ?? 'contain') === fit}
                  title={
                    fit === 'contain'
                      ? 'Show the whole image, letterboxed'
                      : 'Fill the frame, cropping the overflow'
                  }
                  onClick={() => patch({ coverFit: fit === 'contain' ? undefined : 'cover' })}
                >
                  {fit === 'contain' ? 'Fit' : 'Fill'}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => patch({ coverUrl: undefined, coverFit: undefined })}
            title="Remove cover image"
            aria-label="Remove cover image"
            className="btn-icon press hover:text-danger"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={!uploadImage || busy}
          onClick={() => fileRef.current?.click()}
          title="Show an image over the video while this note is on screen"
          className="press flex w-full items-center justify-between gap-2.5 rounded-md border border-line/70 px-[11px] py-2 text-left transition-colors hover:border-line-strong disabled:cursor-default disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-[12.5px] text-muted">
            {busy ? (
              <Loader2 size={14} className="shrink-0 animate-spin" />
            ) : (
              <ImageIcon size={14} className="shrink-0" />
            )}
            {busy ? `Uploading… ${Math.round((progress ?? 0) * 100)}%` : 'Add a cover image'}
          </span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void pickCover(e.target.files?.[0])
          // Let the same file be chosen again after a removal.
          e.target.value = ''
        }}
      />
      {error && <p className="text-[11.5px] text-danger">{error}</p>}

      {/* ---- pin ---- */}
      <button
        type="button"
        role="switch"
        aria-checked={hasPin(annotation)}
        onClick={togglePin}
        title="Drop a dot on the video, captioned with this note's text"
        className={`press flex w-full items-center justify-between gap-2.5 rounded-md border px-[11px] py-2 text-left transition-colors ${
          hasPin(annotation)
            ? 'border-accent/40 bg-accent/[0.06]'
            : 'border-line/70 hover:border-line-strong'
        }`}
      >
        <span
          className={`flex items-center gap-2 text-[12.5px] ${
            hasPin(annotation) ? 'text-fg' : 'text-muted'
          }`}
        >
          <MapPin size={14} className="shrink-0" />
          Pin a caption on the frame
        </span>
        <span className="switch" data-on={hasPin(annotation) || undefined} />
      </button>
      {hasPin(annotation) && (
        <p className="text-[11.5px] leading-relaxed text-muted/80">
          Drag the dot on the video to aim it. This note's text is its caption.
        </p>
      )}

      {/* ---- how long it stays up ----
          Only a point note needs telling: a note with an end already owns a
          span, and that span is the window. */}
      {hasOverlay(annotation) && annotation.end == null && (
        <label className="flex items-center gap-2 text-[12.5px] text-muted">
          <span className="shrink-0">Stays up for</span>
          <input
            type="number"
            min={HOLD_MIN}
            max={HOLD_MAX}
            step={1}
            value={clampHold(overlay.hold)}
            onChange={(e) => {
              const v = Number(e.target.value)
              patch({
                hold:
                  Number.isFinite(v) && clampHold(v) !== OVERLAY_HOLD
                    ? clampHold(v)
                    : undefined,
              })
            }}
            aria-label="Seconds the overlay stays on screen"
            className="field w-20 tabular-nums"
          />
          <span className="shrink-0">seconds</span>
        </label>
      )}
    </div>
  )
}
