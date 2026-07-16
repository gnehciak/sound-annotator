import { useEffect, useRef, useState } from 'react'
import { FileAudio, Loader2, Sparkles, X } from 'lucide-react'
import {
  startSectionDetection,
  pollSectionDetection,
  type AnalysisState,
  type DetectedSection,
} from '../lib/sectionDetect'

const POLL_MS = 5000

type Phase =
  | { kind: 'idle' }
  | { kind: 'prompting' } // YouTube: waiting for the analysis audio drop
  | { kind: 'uploading'; pct: number }
  | { kind: 'running' }
  | { kind: 'done'; count: number }
  | { kind: 'error'; message: string }

/**
 * The Player title-bar action that runs AI section detection (a Replicate GPU
 * job — a couple of minutes) and hands the detected sections up to be applied
 * as structure notes. Audio tracks analyze their uploaded audio directly; a
 * YouTube track first prompts for a matching audio file, which is uploaded to
 * a temporary path, analyzed, and deleted server-side once the run finishes —
 * only the sections and the separated stems are kept. The run itself is
 * server-tracked: navigating away and pressing the button again joins the
 * same job, and a finished result is cached, so a repeat press re-applies
 * without a second billed run. Mount with key={projectId} — a track switch
 * must reset the phase.
 */
export default function DetectSectionsButton({
  projectId,
  uploadAnalysisAudio,
  onSections,
}: {
  projectId: string
  /** Uploads a dropped file to the owner's temp analysis path → its URL. */
  uploadAnalysisAudio: (
    file: File,
    onProgress: (fraction: number) => void,
  ) => Promise<string>
  onSections: (sections: DetectedSection[], bpm?: number) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  // The poll loop is cancelled on unmount; the server-side run keeps going
  // and is rejoined by the next press.
  const runRef = useRef(0)
  useEffect(() => () => void runRef.current++, [])

  function settle(state: AnalysisState) {
    if (state.status === 'done' && state.sections) {
      onSections(state.sections, state.bpm)
      setPhase({ kind: 'done', count: state.sections.length })
      return true
    }
    if (state.status === 'error') {
      setPhase({ kind: 'error', message: state.error ?? 'Analysis failed' })
      return true
    }
    return false
  }

  function fail(run: number, e: unknown) {
    if (run !== runRef.current) return
    setPhase({
      kind: 'error',
      message: e instanceof Error ? e.message : 'Analysis failed',
    })
  }

  async function poll(run: number) {
    while (run === runRef.current) {
      await new Promise((r) => setTimeout(r, POLL_MS))
      if (run !== runRef.current) return
      const state = await pollSectionDetection(projectId)
      if (run !== runRef.current || settle(state)) return
    }
  }

  async function detect() {
    const run = ++runRef.current
    setPhase({ kind: 'running' })
    try {
      const started = await startSectionDetection(projectId)
      if (run !== runRef.current || settle(started)) return
      // A YouTube track with no cached/live run: ask for the audio first.
      if (started.status === 'audio-required') {
        setPhase({ kind: 'prompting' })
        return
      }
      await poll(run)
    } catch (e) {
      fail(run, e)
    }
  }

  async function analyzeFile(file: File) {
    const run = ++runRef.current
    setPhase({ kind: 'uploading', pct: 0 })
    try {
      const url = await uploadAnalysisAudio(file, (pct) => {
        if (run === runRef.current) setPhase({ kind: 'uploading', pct })
      })
      if (run !== runRef.current) return
      setPhase({ kind: 'running' })
      const started = await startSectionDetection(projectId, url)
      if (run !== runRef.current || settle(started)) return
      await poll(run)
    } catch (e) {
      fail(run, e)
    }
  }

  const busy = phase.kind === 'running' || phase.kind === 'uploading'
  const label =
    phase.kind === 'uploading'
      ? `Uploading ${Math.round(phase.pct * 100)}%`
      : phase.kind === 'running'
        ? 'Analyzing…'
        : phase.kind === 'done'
          ? `${phase.count} sections`
          : phase.kind === 'error'
            ? 'Retry detection'
            : 'Detect sections'
  const title =
    phase.kind === 'error'
      ? `Section detection failed: ${phase.message}`
      : phase.kind === 'done'
        ? 'Sections added as structure notes — press again to re-apply'
        : 'Detect song sections (intro / verse / chorus…) with AI — takes a minute or two'

  return (
    <>
      <button
        type="button"
        onClick={() => void detect()}
        disabled={busy}
        title={title}
        aria-label="Detect song sections with AI"
        className={`press inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:pointer-events-none ${
          phase.kind === 'error'
            ? 'border-danger/60 text-danger hover:border-danger'
            : busy
              ? 'border-accent/60 text-accentink'
              : 'border-line text-muted hover:border-line-strong hover:text-fg'
        }`}
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Sparkles size={12} />
        )}
        {label}
      </button>

      {phase.kind === 'prompting' && (
        <AnalysisAudioPrompt
          onFile={(f) => void analyzeFile(f)}
          onCancel={() => setPhase({ kind: 'idle' })}
        />
      )}
    </>
  )
}

/** Modal drop zone for the YouTube flow's analysis audio. */
function AnalysisAudioPrompt({
  onFile,
  onCancel,
}: {
  onFile: (file: File) => void
  onCancel: () => void
}) {
  const [over, setOver] = useState(false)
  const take = (file?: File | null) => {
    if (file && file.type.startsWith('audio/')) onFile(file)
  }
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Provide audio for section detection"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-line bg-panel p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-fg">
            Audio for analysis
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="press -mr-1 -mt-1 grid h-7 w-7 place-items-center rounded text-muted transition-colors hover:bg-raised hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>
        <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
          YouTube doesn’t hand apps the audio, so drop a recording of this
          track to analyze. Use the <span className="text-fg">same edit as
          the video</span> — otherwise the section timestamps won’t line up.
          The file is used once and deleted after the analysis; only the
          detected sections and the separated stems are kept.
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
          className={`flex cursor-pointer flex-col items-center gap-2 rounded border border-dashed p-6 text-center transition-colors ${
            over ? 'border-accent bg-accent/10' : 'border-line-strong bg-inset hover:border-accent/60'
          }`}
        >
          <FileAudio size={20} className="text-muted" />
          <span className="text-[12.5px] text-fg">
            Drop an audio file, or click to choose
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            mp3 · m4a · wav — up to 60 MB
          </span>
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              take(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </label>
      </div>
    </div>
  )
}
