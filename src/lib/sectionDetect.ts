// Client side of AI section detection (api/projects/[id]/analyze.ts): start /
// poll the analysis, and turn its raw sections into structure annotations.
import { api } from './api'
import { makeTextBlock } from './noteBlocks'
import type { Annotation } from '../types'

export interface DetectedSection {
  /** seconds */
  start: number
  /** seconds */
  end: number
  /** raw allin1 label: intro | verse | chorus | bridge | inst | solo | break | outro */
  label: string
}

export interface AnalysisState {
  /** 'audio-required': a YouTube project needs an analysis audio upload first. */
  status: 'none' | 'audio-required' | 'running' | 'done' | 'error'
  sections?: DetectedSection[]
  bpm?: number
  /** Blob URLs of the saved stems (vocals/drums/bass/guitar/piano/other). */
  stems?: Record<string, string>
  error?: string
}

/**
 * Kick off (or join / return the cached result of) the project's analysis.
 * YouTube projects pass the just-uploaded analysis audio's URL; without one
 * the server answers 'audio-required'.
 */
export function startSectionDetection(
  projectId: string,
  audioUrl?: string,
): Promise<AnalysisState> {
  return api<AnalysisState>(
    `/api/projects/${encodeURIComponent(projectId)}/analyze`,
    { method: 'POST', json: audioUrl ? { audioUrl } : {} },
  )
}

/** One poll of a running analysis. */
export function pollSectionDetection(projectId: string): Promise<AnalysisState> {
  return api<AnalysisState>(
    `/api/projects/${encodeURIComponent(projectId)}/analyze`,
  )
}

/** Ids of AI-detected section notes carry this prefix, so a re-apply can
 *  replace the previous batch instead of stacking duplicates. */
export const AI_SECTION_PREFIX = 'ai-sec-'

const LABEL_NAMES: Record<string, string> = {
  intro: 'Intro',
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  inst: 'Instrumental',
  solo: 'Solo',
  break: 'Break',
  outro: 'Outro',
}

/**
 * Detected sections as structure annotations: ranged notes with the structure
 * bracket + section name, so they land in the overview rail, the waveform and
 * the notes list like hand-made ones. Repeated labels are numbered (Verse 1,
 * Verse 2) — a label that occurs once keeps its bare name.
 */
export function sectionsToAnnotations(sections: DetectedSection[]): Annotation[] {
  const total = new Map<string, number>()
  for (const s of sections) total.set(s.label, (total.get(s.label) ?? 0) + 1)
  const seen = new Map<string, number>()
  const at = Date.now()
  return sections.map((s) => {
    const nth = (seen.get(s.label) ?? 0) + 1
    seen.set(s.label, nth)
    const base = LABEL_NAMES[s.label] ?? s.label.charAt(0).toUpperCase() + s.label.slice(1)
    const name = (total.get(s.label) ?? 1) > 1 ? `${base} ${nth}` : base
    return {
      id: `${AI_SECTION_PREFIX}${crypto.randomUUID()}`,
      start: s.start,
      end: Math.max(s.end, s.start + 1),
      structure: true,
      sectionName: name,
      contentHtml: '',
      blocks: [makeTextBlock('')],
      createdAt: at,
    }
  })
}
