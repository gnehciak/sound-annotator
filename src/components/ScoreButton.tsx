import { useRef, useState } from 'react'
import {
  ExternalLink,
  ListMusic,
  Loader2,
  RotateCw,
  ScrollText,
  Trash2,
  Upload,
} from 'lucide-react'
import Popover from './Popover'
import type { ProjectScore, ScoreFit, ScoreMode } from '../types'
import {
  DEFAULT_SCORE_OPACITY,
  scoreFromLink,
  scoreLabel,
  scoreLinkUrl,
  type ScoreView,
} from '../lib/score'

/**
 * The Player title-bar action for the PDF score: attach one, and decide how it
 * sits over the picture.
 *
 * Three callers with three sets of rights, all through the same menu:
 *  • an owner — everything, including uploading a PDF we host;
 *  • a guest or a link editor — may link a Drive score but not upload one
 *    (`onUpload` absent), because hosted bytes need an account to own them;
 *  • a read-only reader (the share viewer) — `onScore` absent: they can change
 *    how the score is shown for their own session, but not what it is.
 */
export default function ScoreButton({
  score,
  view,
  videoSource,
  onView,
  onReload,
  onScore,
  onUpload,
  onSync,
}: {
  score?: ProjectScore
  view: ScoreView
  /** Whether there is a picture to lay the score over — video tracks only. */
  videoSource?: boolean
  onView: (patch: Partial<ScoreView>) => void
  /** Re-fetch the bytes, past both caches — Drive scores change under us. */
  onReload: () => void
  /** Absent when the caller may not change the score itself. */
  onScore?: (next: ProjectScore | null) => void
  /** Absent when the caller has no account to host bytes under. */
  onUpload?: (file: File, onProgress: (fraction: number) => void) => Promise<string>
  /** Open the sync workspace. Absent when the caller may not retime the score. */
  onSync?: () => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const canAttach = Boolean(onScore)
  // Nothing to open a menu for: no score, and no right to attach one.
  if (!score && !canAttach) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={score ? 'Score — where it shows, and how' : 'Add a PDF score'}
        aria-label={score ? 'Score options' : 'Add a PDF score'}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`btn-ghost btn-sm press shrink-0 ${
          score && view.mode !== 'off' ? 'text-accentink' : ''
        }`}
      >
        <ScrollText size={12} />
        {/* Once there's a score the column's view switch is already labelled
            "Score" a few pixels away, and two of the word side by side reads
            as one control cut in half. This one keeps the icon; the label is
            only needed while it is the invitation to attach one. */}
        {score ? null : 'Add score'}
      </button>

      <Popover
        open={open}
        anchorRef={triggerRef}
        onClose={() => setOpen(false)}
        width={272}
        className="p-2.5"
      >
        {score ? (
          <ScoreSettings
            score={score}
            view={view}
            videoSource={videoSource}
            onView={onView}
            onReload={() => {
              onReload()
              setOpen(false)
            }}
            onScore={onScore}
            onUpload={onUpload}
            onSync={
              onSync &&
              (() => {
                setOpen(false)
                onSync()
              })
            }
          />
        ) : (
          <ScoreAttach
            onScore={(next) => {
              onScore?.(next)
              setOpen(false)
            }}
            onUpload={onUpload}
          />
        )}
      </Popover>
    </>
  )
}

// ---- attaching ------------------------------------------------------------

const MODES: { value: ScoreMode; label: string; title: string }[] = [
  { value: 'off', label: 'Player', title: 'The player — the score is put away' },
  { value: 'view', label: 'Score', title: 'The score, in its own view of this column' },
]

const FITS: { value: ScoreFit; label: string; title: string }[] = [
  { value: 'height', label: 'Page', title: 'The whole page, fitted to the frame' },
  { value: 'width', label: 'Width', title: 'Fill the width — bigger staves, scrolls' },
]

/** The form shown when the track has no score yet. */
function ScoreAttach({
  onScore,
  onUpload,
}: {
  onScore: (score: ProjectScore) => void
  onUpload?: (file: File, onProgress: (fraction: number) => void) => Promise<string>
}) {
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const attachLink = () => {
    const result = scoreFromLink(link)
    if ('error' in result) {
      setError(result.error)
      return
    }
    onScore(result.score)
  }

  const attachFile = async (file: File | null | undefined) => {
    if (!file || !onUpload) return
    setError(null)
    setUploading(0)
    try {
      const url = await onUpload(file, (f) => setUploading(f))
      onScore({ kind: 'blob', url, fileName: file.name })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That upload failed.')
    } finally {
      setUploading(null)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Google Drive link</Label>
      <input
        value={link}
        onChange={(e) => {
          setLink(e.target.value)
          setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            attachLink()
          }
        }}
        placeholder="https://drive.google.com/file/d/…"
        aria-label="Google Drive link to the score PDF"
        className="field text-[12px]"
      />
      <p className="text-[11px] leading-snug text-muted">
        Share the PDF as <strong className="font-semibold">Anyone with the link</strong>.
        Annotate it in Drive later and everyone sees the new version — as long as
        you keep the same file.
      </p>
      <button
        type="button"
        onClick={attachLink}
        disabled={!link.trim()}
        className="btn-signal btn-sm press w-full justify-center"
      >
        Link this score
      </button>

      {onUpload && (
        <>
          <div className="my-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              void attachFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading != null}
            className="btn-ghost btn-sm press w-full justify-center"
          >
            {uploading != null ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Uploading {Math.round(uploading * 100)}%
              </>
            ) : (
              <>
                <Upload size={12} />
                Upload a PDF
              </>
            )}
          </button>
          <p className="text-[11px] leading-snug text-muted">
            An upload is fixed once it&rsquo;s here — changing it means uploading
            again.
          </p>
        </>
      )}

      {error && <p className="text-[11px] leading-snug text-danger">{error}</p>}
    </div>
  )
}

// ---- settings for an attached score ---------------------------------------

function ScoreSettings({
  score,
  view,
  videoSource,
  onView,
  onReload,
  onScore,
  onUpload,
  onSync,
}: {
  score: ProjectScore
  view: ScoreView
  videoSource?: boolean
  onView: (patch: Partial<ScoreView>) => void
  onReload: () => void
  onScore?: (next: ProjectScore | null) => void
  onUpload?: (file: File, onProgress: (fraction: number) => void) => Promise<string>
  onSync?: () => void
}) {
  const [replacing, setReplacing] = useState(false)
  const link = scoreLinkUrl(score)
  const turns = score.turns?.length ?? 0

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-fg" title={scoreLabel(score)}>
          {scoreLabel(score)}
        </span>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the PDF in Drive (new tab)"
            className="btn-icon press shrink-0 text-muted"
            aria-label="Open the score in Drive"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div>
        <Label>This column shows</Label>
        <div className="seg mt-1 grid grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => onView({ mode: m.value })}
              aria-pressed={view.mode === m.value}
              title={m.title}
              className="seg-item"
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* The old overlay, kept under its own switch. Seeing the staves over
          the moving picture is its own thing, and the score view — which
          replaces the picture — can't do it. Video tracks only: an audio
          track's waveform is the picture and stays uncovered. */}
      {videoSource && (
        <button
          type="button"
          onClick={() => onView({ overVideo: !view.overVideo })}
          aria-pressed={view.overVideo}
          title="Lay the score over the video as well, dimmed, while this column is on the player"
          className="flex w-full items-center justify-between gap-2 rounded px-0.5 py-1 text-left hover:bg-raised"
        >
          <span className={`text-[12px] ${view.overVideo ? 'text-fg' : 'text-muted'}`}>
            Also over the video
          </span>
          <span className="switch" data-on={view.overVideo || undefined} />
        </button>
      )}

      {videoSource && view.overVideo && (
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] text-muted">Opacity</span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round((view.opacity ?? DEFAULT_SCORE_OPACITY) * 100)}
            onChange={(e) => onView({ opacity: Number(e.target.value) / 100 })}
            aria-label="Score opacity"
            className="flex-1 accent-accent"
          />
          <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted">
            {Math.round(view.opacity * 100)}%
          </span>
        </label>
      )}

      {videoSource && view.overVideo && (
        <button
          type="button"
          onClick={() => onView({ onTop: !view.onTop })}
          aria-pressed={view.onTop}
          title="Note covers and pins take over the picture; this decides whether they cover the score too. The transport stays on top either way."
          className="flex w-full items-center justify-between gap-2 rounded px-0.5 py-1 text-left hover:bg-raised"
        >
          <span
            className={`text-[12px] ${view.onTop ? 'text-fg' : 'text-muted'}`}
          >
            Keep above note covers
          </span>
          <span className="switch" data-on={view.onTop || undefined} />
        </button>
      )}

      {(view.mode === 'view' || view.overVideo) && (
        <div>
          <Label>Fit</Label>
          <div className="seg mt-1 grid grid-cols-2">
            {FITS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onView({ fit: f.value })}
                aria-pressed={view.fit === f.value}
                title={f.title}
                className="seg-item"
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-line pt-2">
        {onSync ? (
          <button type="button" onClick={onSync} className="pop-row rounded">
            <ListMusic size={13} />
            {turns > 0
              ? `Page turns — ${turns} set…`
              : 'Sync the page turns…'}
          </button>
        ) : (
          turns > 0 && (
            <p className="px-2.5 py-1.5 text-[11px] text-muted">
              This score turns its own pages.
            </p>
          )
        )}
        {score.kind === 'drive' && (
          <button type="button" onClick={onReload} className="pop-row rounded">
            <RotateCw size={13} />
            Reload from Drive
          </button>
        )}
        {onScore && (
          <>
            {replacing ? (
              <div className="pt-1">
                <ScoreAttach onScore={onScore} onUpload={onUpload} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setReplacing(true)}
                className="pop-row rounded"
              >
                <Upload size={13} />
                Replace the score…
              </button>
            )}
            <button
              type="button"
              onClick={() => onScore(null)}
              className="pop-row rounded text-danger hover:text-danger"
            >
              <Trash2 size={13} />
              Remove the score
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
      {children}
    </span>
  )
}
