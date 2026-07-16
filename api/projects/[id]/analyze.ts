// POST / GET /api/projects/:id/analyze — AI song-section detection, owner-only.
//
// POST kicks off a run of the All-In-One Music Structure Analyzer (the allin1
// model of Kim & Nam 2023, hosted on Replicate as erickluis00/all-in-one-audio)
// against the project's uploaded audio, and stamps the job state into the
// `analysis` jsonb column. A finished result is cached there, so a repeat POST
// returns it instead of paying for a second GPU run; POST after an error
// retries.
//
// GET polls: while the job runs it asks Replicate for the prediction's status,
// and on success fetches the analyzer's result JSON, distills it to labelled
// sections ({start, end, label} in seconds), and caches that on the row. The
// client applies the sections as structure annotations — the server never
// touches `annotations` (those writes stay behind the edit lock in index.ts).
//
// No webhook on purpose: polling behaves identically under `vercel dev` and
// in production, and a run someone abandoned mid-flight simply resumes the
// next time the button is pressed.
import { getUid } from '../../_lib/auth.js'
import { sql, getProjectRow, jsonb, type ProjectRow } from '../../_lib/db.js'
import { json, err } from '../../_lib/respond.js'

const REPLICATE_API = 'https://api.replicate.com/v1'
const MODEL = 'erickluis00/all-in-one-audio'

export interface DetectedSection {
  start: number
  end: number
  label: string
}

/** The `analysis` jsonb column. */
interface Analysis {
  status: 'running' | 'done' | 'error'
  predictionId?: string
  sections?: DetectedSection[]
  bpm?: number
  startedAt?: number
  finishedAt?: number
  error?: string
}

function idFrom(request: Request): string {
  const parts = new URL(request.url).pathname.split('/').filter(Boolean)
  return decodeURIComponent(parts[2] ?? '') // /api/projects/<id>/analyze
}

/** Owner-only: analysis spends the owner's Replicate credit and writes the
 *  result onto their row, so link editors don't get the button. */
async function ownedRow(
  request: Request,
  id: string,
): Promise<ProjectRow | Response> {
  const uid = await getUid(request)
  if (!uid) return err(401, 'Sign in required')
  const row = await getProjectRow(id)
  if (!row) return err(404, 'Not found')
  if (row.owner_id !== uid) return err(403, 'Not yours')
  return row
}

async function saveAnalysis(id: string, a: Analysis): Promise<void> {
  await sql`UPDATE projects SET analysis = ${jsonb(a)}::jsonb WHERE id = ${id}`
}

/** Strip the analysis to what the client needs (never the prediction id). */
function toClient(a: Analysis | null): Record<string, unknown> {
  if (!a) return { status: 'none' }
  return {
    status: a.status,
    sections: a.sections,
    bpm: a.bpm,
    error: a.error,
  }
}

async function replicate(
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${REPLICATE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { ok: res.ok, status: res.status, data }
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.REPLICATE_API_TOKEN)
    return err(500, 'Section detection is not configured (REPLICATE_API_TOKEN)')
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const row = await ownedRow(request, id)
  if (row instanceof Response) return row

  const source = row.source as
    | { type?: string; audioUrl?: string }
    | null
    | undefined
  if (source?.type !== 'audio' || !source.audioUrl)
    return err(400, 'Section detection needs an uploaded audio file')

  // A finished run is cached; a live one is joined, not duplicated. Only an
  // errored (or absent) analysis starts a fresh — billed — prediction.
  const existing = row.analysis as Analysis | null
  if (existing?.status === 'done' || existing?.status === 'running')
    return json(toClient(existing))

  const { ok, status, data } = await replicate(
    `/models/${MODEL}/predictions`,
    {
      method: 'POST',
      body: JSON.stringify({ input: { music_input: source.audioUrl } }),
    },
  )
  if (!ok || typeof data.id !== 'string') {
    const detail = typeof data.detail === 'string' ? data.detail : `HTTP ${status}`
    return err(502, `Could not start the analysis: ${detail}`)
  }

  const analysis: Analysis = {
    status: 'running',
    predictionId: data.id,
    startedAt: Date.now(),
  }
  await saveAnalysis(id, analysis)
  return json(toClient(analysis))
}

export async function GET(request: Request): Promise<Response> {
  const id = idFrom(request)
  if (!id) return err(400, 'Missing project id')
  const row = await ownedRow(request, id)
  if (row instanceof Response) return row

  const analysis = row.analysis as Analysis | null
  if (!analysis || analysis.status !== 'running' || !analysis.predictionId)
    return json(toClient(analysis))

  const { ok, data } = await replicate(`/predictions/${analysis.predictionId}`)
  if (!ok) return json(toClient(analysis)) // transient — client keeps polling

  const state = data.status as string
  if (state === 'starting' || state === 'processing')
    return json(toClient(analysis))

  if (state !== 'succeeded') {
    const failed: Analysis = {
      status: 'error',
      error:
        typeof data.error === 'string' && data.error
          ? data.error
          : `Analysis ${state ?? 'failed'}`,
      finishedAt: Date.now(),
    }
    await saveAnalysis(id, failed)
    return json(toClient(failed))
  }

  try {
    const result = await parseAnalyzerResult(
      (data.output as Record<string, unknown> | null)?.analyzer_result,
    )
    const done: Analysis = {
      status: 'done',
      predictionId: analysis.predictionId,
      startedAt: analysis.startedAt,
      finishedAt: Date.now(),
      ...result,
    }
    await saveAnalysis(id, done)
    return json(toClient(done))
  } catch (e) {
    const failed: Analysis = {
      status: 'error',
      error: e instanceof Error ? e.message : 'Could not read the analysis result',
      finishedAt: Date.now(),
    }
    await saveAnalysis(id, failed)
    return json(toClient(failed))
  }
}

/**
 * Fetch and distill the allin1 result file. The model returns a URI to a JSON
 * like { bpm, beats, downbeats, segments: [{start, end, label}] }; labels are
 * lowercase functional names (intro, verse, chorus, bridge, inst, solo, break,
 * outro) plus 'start'/'end' padding segments, which are dropped.
 */
async function parseAnalyzerResult(
  output: unknown,
): Promise<{ sections: DetectedSection[]; bpm?: number }> {
  const uri = Array.isArray(output) ? output[0] : output
  if (typeof uri !== 'string') throw new Error('No analyzer result in the output')
  const res = await fetch(uri)
  if (!res.ok) throw new Error('The analysis result file has expired')
  const parsed = (await res.json()) as {
    bpm?: number
    segments?: { start?: number; end?: number; label?: string }[]
  }
  const sections = (parsed.segments ?? [])
    .filter(
      (s): s is { start: number; end: number; label: string } =>
        typeof s.start === 'number' &&
        typeof s.end === 'number' &&
        typeof s.label === 'string' &&
        s.end > s.start &&
        s.label !== 'start' &&
        s.label !== 'end',
    )
    .map((s) => ({
      start: Math.round(s.start * 10) / 10,
      end: Math.round(s.end * 10) / 10,
      label: s.label,
    }))
  if (sections.length === 0) throw new Error('The analyzer found no sections')
  return { sections, bpm: typeof parsed.bpm === 'number' ? parsed.bpm : undefined }
}
