import { useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import {
  startSectionDetection,
  pollSectionDetection,
  type AnalysisState,
  type DetectedSection,
} from '../lib/sectionDetect'

const POLL_MS = 5000

type Phase =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; count: number }
  | { kind: 'error'; message: string }

/**
 * The Player title-bar action that runs AI section detection on the track's
 * uploaded audio (a Replicate GPU job — a couple of minutes) and hands the
 * detected sections up to be applied as structure notes. The run itself is
 * server-tracked: navigating away and pressing the button again joins the
 * same job, and a finished result is cached, so a repeat press re-applies
 * without a second billed run. Mount with key={projectId} — a track switch
 * must reset the phase.
 */
export default function DetectSectionsButton({
  projectId,
  onSections,
}: {
  projectId: string
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

  async function detect() {
    const run = ++runRef.current
    setPhase({ kind: 'running' })
    try {
      const started = await startSectionDetection(projectId)
      if (run !== runRef.current || settle(started)) return
      while (run === runRef.current) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (run !== runRef.current) return
        const state = await pollSectionDetection(projectId)
        if (run !== runRef.current || settle(state)) return
      }
    } catch (e) {
      if (run !== runRef.current) return
      setPhase({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Analysis failed',
      })
    }
  }

  const running = phase.kind === 'running'
  const label =
    phase.kind === 'running'
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
    <button
      type="button"
      onClick={() => void detect()}
      disabled={running}
      title={title}
      aria-label="Detect song sections with AI"
      className={`press inline-flex shrink-0 items-center gap-1.5 rounded border px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:pointer-events-none ${
        phase.kind === 'error'
          ? 'border-danger/60 text-danger hover:border-danger'
          : running
            ? 'border-accent/60 text-accentink'
            : 'border-line text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {running ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <Sparkles size={12} />
      )}
      {label}
    </button>
  )
}
