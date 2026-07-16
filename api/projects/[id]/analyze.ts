// POST / GET /api/projects/:id/analyze — AI song-section detection, owner-only.
//
// POST kicks off a run of the All-In-One Music Structure Analyzer (the allin1
// model of Kim & Nam 2023, hosted on Replicate as erickluis00/all-in-one-audio)
// and stamps the job state into the `analysis` jsonb column. Audio projects
// analyze their own uploaded audio; YouTube projects analyze a *temporary*
// audio upload the owner drops in (users/{uid}/analysis/{projectId}) — the
// client learns it's needed via `{ status: 'audio-required' }`. A finished
// result is cached, so a repeat POST returns it instead of paying for a second
// GPU run; POST after an error retries.
//
// GET polls: while the job runs it asks Replicate for the prediction's status.
// On success it *finalizes*: distills the analyzer's result JSON to labelled
// sections ({start, end, label} in seconds), copies the run's Demucs stems
// (vocals/drums/bass/guitar/piano/other — free by-products of the analysis,
// but expiring on Replicate within the hour) into Blob under
// users/{uid}/stems/{projectId}/, deletes the temporary analysis upload, and
// caches it all on the row. Finalizing is guarded by a status + timestamp so
// concurrent polls don't copy twice, and a finalize killed mid-copy (function
// timeout) goes stale and is retried by a later poll. The client applies the
// sections as structure annotations — the server never touches `annotations`
// (those writes stay behind the edit lock in index.ts).
//
// No webhook on purpose: polling behaves identically under `vercel dev` and
// in production, and a run someone abandoned mid-flight simply resumes the
// next time the button is pressed.
import { put, del } from '@vercel/blob'
import { getUid } from '../../_lib/auth.js'
import { sql, getProjectRow, jsonb, type ProjectRow } from '../../_lib/db.js'
import { json, err } from '../../_lib/respond.js'

// Finalizing streams several stem files (tens of MB each) between Replicate
// and Blob — give it the full window.
export const maxDuration = 300

const REPLICATE_API = 'https://api.replicate.com/v1'
// erickluis00/all-in-one-audio, pinned to its latest (2023) version — the
// model-scoped predictions endpoint is official-models-only, so community
// models are run by version hash via POST /v1/predictions.
const MODEL_VERSION =
  'f2a8516c9084ef460592deaa397acd4a97f60f18c3d15d273644c72500cdff0e'

// A 'finalizing' stamp older than this is presumed crashed and retried.
const FINALIZE_STALE_MS = 5 * 60_000

const STEM_KEYS = [
  'demucs_vocals',
  'demucs_drums',
  'demucs_bass',
  'demucs_guitar',
  'demucs_piano',
  'demucs_other',
] as const

export interface DetectedSection {
  start: number
  end: number
  label: string
}

/** The `analysis` jsonb column. */
interface Analysis {
  status: 'running' | 'finalizing' | 'done' | 'error'
  predictionId?: string
  sections?: DetectedSection[]
  bpm?: number
  /** Blob URLs of the separated stems, keyed vocals/drums/bass/guitar/piano/other. */
  stems?: Record<string, string>
  /** The temporary analysis upload (YouTube flow) — deleted at finalize. */
  sourceAudioUrl?: string
  startedAt?: number
  finalizeAt?: number
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

/** Strip the analysis to what the client needs (never the prediction id or
 *  the temp upload URL). Finalizing reads as running — same client behavior,
 *  keep polling. */
function toClient(a: Analysis | null): Record<string, unknown> {
  if (!a) return { status: 'none' }
  return {
    status: a.status === 'finalizing' ? 'running' : a.status,
    sections: a.sections,
    bpm: a.bpm,
    stems: a.stems,
    error: a.error,
  }
}

/** True when `url` is a Vercel Blob object inside the owner's analysis
 *  prefix — the only audio a YouTube project may hand to the analyzer (our
 *  GPU credit only ever runs against the caller's own upload). */
function isOwnAnalysisUpload(url: string, uid: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.hostname.endsWith('.blob.vercel-storage.com') &&
      u.pathname.startsWith(`/users/${uid}/analysis/`)
    )
  } catch {
    return false
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

  // A finished run is cached; a live one is joined, not duplicated. Only an
  // errored (or absent) analysis starts a fresh — billed — prediction.
  const existing = row.analysis as Analysis | null
  if (existing && existing.status !== 'error') return json(toClient(existing))

  const source = row.source as
    | { type?: string; audioUrl?: string }
    | null
    | undefined
  let audioUrl: string
  let temp = false
  if (source?.type === 'audio' && source.audioUrl) {
    audioUrl = source.audioUrl
  } else if (source?.type === 'youtube') {
    // YouTube gives us no audio: the owner supplies a matching recording,
    // pre-uploaded to their own analysis prefix. Signalled as a state (not an
    // error) so the client opens its drop prompt.
    const body = (await request.json().catch(() => null)) as
      | { audioUrl?: string }
      | null
    if (!body?.audioUrl) return json({ status: 'audio-required' })
    if (!isOwnAnalysisUpload(body.audioUrl, row.owner_id))
      return err(403, 'Analysis audio must be your own analysis upload')
    audioUrl = body.audioUrl
    temp = true
  } else {
    return err(400, 'Section detection needs an audio source')
  }

  const { ok, status, data } = await replicate('/predictions', {
    method: 'POST',
    body: JSON.stringify({
      version: MODEL_VERSION,
      input: { music_input: audioUrl },
    }),
  })
  if (!ok || typeof data.id !== 'string') {
    const detail = typeof data.detail === 'string' ? data.detail : `HTTP ${status}`
    return err(502, `Could not start the analysis: ${detail}`)
  }

  const analysis: Analysis = {
    status: 'running',
    predictionId: data.id,
    startedAt: Date.now(),
    ...(temp ? { sourceAudioUrl: audioUrl } : {}),
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

  // A finalize that died mid-copy (timeout, crash) goes stale and is retried;
  // a live one just reads as running.
  if (analysis?.status === 'finalizing' && analysis.predictionId) {
    if (Date.now() - (analysis.finalizeAt ?? 0) < FINALIZE_STALE_MS)
      return json(toClient(analysis))
    return finalize(id, row.owner_id, { ...analysis, finalizeAt: Date.now() })
  }

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

  // Claim the finalize before the heavy copying, so a concurrent poll (second
  // tab) sees 'finalizing' and stands down instead of copying stems twice.
  const claimed: Analysis = {
    ...analysis,
    status: 'finalizing',
    finalizeAt: Date.now(),
  }
  await saveAnalysis(id, claimed)
  return finalize(id, row.owner_id, claimed, data.output)
}

/**
 * Turn a succeeded prediction into the cached result: sections from the
 * analyzer JSON, stems copied into the owner's Blob space (Replicate deletes
 * its outputs within about an hour), the temporary analysis upload deleted.
 * `output` is passed through from a fresh poll; a stale-finalize retry
 * refetches the prediction instead.
 */
async function finalize(
  id: string,
  uid: string,
  analysis: Analysis,
  output?: unknown,
): Promise<Response> {
  try {
    if (output === undefined) {
      const { ok, data } = await replicate(`/predictions/${analysis.predictionId}`)
      if (!ok || data.status !== 'succeeded')
        throw new Error('The analysis result is no longer available')
      output = data.output
    }
    const out = (output ?? {}) as Record<string, unknown>
    const result = await parseAnalyzerResult(out.analyzer_result)
    const stems = await copyStems(uid, id, out)

    // The dropped audio was only ever fuel for the analysis — its deletion is
    // the promise the YouTube flow makes. Best-effort: a failure here leaves
    // a stray blob, not a broken analysis (swept with the project's other
    // artifacts on delete).
    if (analysis.sourceAudioUrl) await del(analysis.sourceAudioUrl).catch(() => {})

    const done: Analysis = {
      status: 'done',
      predictionId: analysis.predictionId,
      startedAt: analysis.startedAt,
      finishedAt: Date.now(),
      ...(Object.keys(stems).length > 0 ? { stems } : {}),
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

/** Stream each Demucs stem from Replicate's expiring output into the owner's
 *  Blob space. Per-stem best-effort: sections must never fail because one
 *  stem copy did. */
async function copyStems(
  uid: string,
  projectId: string,
  output: Record<string, unknown>,
): Promise<Record<string, string>> {
  const copied = await Promise.all(
    STEM_KEYS.map(async (key) => {
      const uri = output[key]
      if (typeof uri !== 'string') return null
      try {
        const res = await fetch(uri)
        if (!res.ok || !res.body) return null
        const name = key.replace('demucs_', '')
        const ext =
          new URL(uri).pathname.match(/\.(\w+)$/)?.[1]?.toLowerCase() ?? 'wav'
        const blob = await put(
          `users/${uid}/stems/${projectId}/${name}.${ext}`,
          res.body,
          {
            access: 'public',
            allowOverwrite: true,
            contentType: res.headers.get('content-type') ?? undefined,
          },
        )
        return [name, blob.url] as const
      } catch {
        return null
      }
    }),
  )
  return Object.fromEntries(copied.filter((e): e is [string, string] => e != null))
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
