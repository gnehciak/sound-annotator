// Portable JSON import/export for a track: a small versioned envelope carrying
// only the content that survives a round trip — title, source, notes, settings.
// Account and sharing state (ownerId, shared/published flags, folder, lock)
// deliberately stays out: an export is a document, not a database row.
//
// Export is a pure client-side download. Import parses and sanitises the file
// back into a Project shape; App then runs it through copySharedProject so the
// imported track gets a fresh id and owns its bytes (audio + note images are
// re-uploaded under the importer's storage while the referenced URLs live).
//
// MAINTENANCE CONTRACT: every persisted content field on Project /
// ProjectSource / Annotation / ProjectSettings must round-trip through here.
// When adding one, add it to the export envelope (content only — never
// account/sharing state) AND teach the matching sanitizer below to accept it;
// settings keys holding primitives already pass through automatically. Bump
// PROJECT_JSON_VERSION only for breaking shape changes (old files must keep
// importing). See the note atop src/types.ts.
import type {
  Annotation,
  ChordStamp,
  NoteBlock,
  Project,
  ProjectSettings,
  ProjectSource,
} from '../types'
import { withBlocks } from './noteBlocks'

export const PROJECT_JSON_FORMAT = 'sound-annotator-project'
export const PROJECT_JSON_VERSION = 1

interface ProjectJsonEnvelope {
  format: typeof PROJECT_JSON_FORMAT
  version: number
  exportedAt: number
  project: Pick<Project, 'title' | 'source' | 'annotations' | 'settings'>
}

/** Serialize a project to the portable JSON document (pretty-printed). */
export function projectToJson(p: Project): string {
  const envelope: ProjectJsonEnvelope = {
    format: PROJECT_JSON_FORMAT,
    version: PROJECT_JSON_VERSION,
    exportedAt: Date.now(),
    project: {
      title: p.title,
      source: p.source,
      annotations: p.annotations,
      settings: p.settings,
    },
  }
  return JSON.stringify(envelope, null, 2)
}

/** File-safe download name: "Mahler 5 — Adagietto" → "mahler-5-adagietto.json". */
function exportFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'untitled-track'}.json`
}

/** Export a project as a downloaded `.json` file. */
export function downloadProjectJson(p: Project): void {
  const blob = new Blob([projectToJson(p)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFileName(p.title)
  a.click()
  // The click only starts the download; give the browser a beat before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---- import (parse + sanitise) --------------------------------------------
// The file is user-supplied data: every field is re-validated rather than
// trusted, so a hand-edited or truncated export degrades to dropped fields
// (or dropped notes) instead of a crashing editor.

const str = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : undefined

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

function sanitizeSource(v: unknown): ProjectSource | undefined {
  if (!v || typeof v !== 'object') return undefined
  const s = v as Record<string, unknown>
  if (s.type === 'youtube') {
    const source: ProjectSource = { type: 'youtube' }
    const youtubeUrl = str(s.youtubeUrl)
    const videoId = str(s.videoId)
    if (youtubeUrl) source.youtubeUrl = youtubeUrl
    if (videoId) source.videoId = videoId
    return videoId || youtubeUrl ? source : undefined
  }
  if (s.type === 'audio') {
    const source: ProjectSource = { type: 'audio' }
    const fileName = str(s.fileName)
    const audioUrl = str(s.audioUrl)
    if (fileName) source.fileName = fileName
    if (audioUrl) source.audioUrl = audioUrl
    return source
  }
  return undefined
}

function sanitizeBlocks(v: unknown): NoteBlock[] | undefined {
  if (!Array.isArray(v)) return undefined
  const blocks: NoteBlock[] = []
  for (const b of v) {
    if (!b || typeof b !== 'object') continue
    const raw = b as Record<string, unknown>
    const type = str(raw.type)
    if (!type) continue
    blocks.push({ id: str(raw.id) ?? crypto.randomUUID(), type, data: raw.data })
  }
  return blocks.length > 0 ? blocks : undefined
}

/** A section's painted chord stamps: whole-beat, positive, capped, sorted. */
function sanitizeChordStamps(v: unknown): ChordStamp[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: ChordStamp[] = []
  for (const raw of v.slice(0, 1000)) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    const b = num(e.b)
    const d = num(e.d)
    const n = str(e.n)
    if (b == null || b < 0 || d == null || d < 1 || !n) continue
    out.push({ b: Math.round(b), d: Math.round(d), n: n.slice(0, 32) })
  }
  return out.length > 0 ? out.sort((a, z) => a.b - z.b) : undefined
}

/** One note from the file, or null when it's beyond salvage (no valid start). */
function sanitizeAnnotation(v: unknown): Annotation | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const start = num(a.start)
  if (start == null || start < 0) return null
  const ann: Annotation = {
    id: str(a.id) ?? crypto.randomUUID(),
    start,
    contentHtml: str(a.contentHtml) ?? '',
    createdAt: num(a.createdAt) ?? Date.now(),
  }
  const end = num(a.end)
  if (end != null && end > start) ann.end = end
  const tag = str(a.tag)
  if (tag) ann.tag = tag
  if (Array.isArray(a.tags)) {
    const tags = a.tags.filter((t): t is string => typeof t === 'string')
    if (tags.length > 0) ann.tags = tags
  }
  const color = str(a.color)
  if (color) ann.color = color
  const bar = str(a.bar)
  if (bar) ann.bar = bar
  const order = num(a.order)
  if (order != null) ann.order = order
  if (a.structure === true) ann.structure = true
  const sectionName = str(a.sectionName)
  if (sectionName) ann.sectionName = sectionName
  const lyrics = str(a.lyrics)
  if (lyrics) ann.lyrics = lyrics
  const chordEvents = sanitizeChordStamps(a.chordEvents)
  if (chordEvents) ann.chordEvents = chordEvents
  const blocks = sanitizeBlocks(a.blocks)
  if (blocks) ann.blocks = blocks
  // Legacy exports (contentHtml only) get their text block here, like any read.
  return withBlocks(ann)
}

const NOTE_ORDERS = new Set(['timeline', 'auto', 'live'])

/**
 * Settings pass through leniently: any key holding a primitive survives, so a
 * settings knob added later — including the project `kind` that makes a track
 * open as a song-structure board — round-trips without this file having to
 * know it. Only `noteOrder` is checked against its enum (an unknown value
 * would silently break the notes-list sorting); everything non-primitive
 * (nested objects, arrays) is dropped.
 */
function sanitizeSettings(v: unknown): ProjectSettings | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const settings: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(v)) {
    if (
      typeof val === 'boolean' ||
      (typeof val === 'number' && Number.isFinite(val)) ||
      (typeof val === 'string' && val.length <= 200)
    )
      settings[key] = val
  }
  if (
    settings.noteOrder !== undefined &&
    !NOTE_ORDERS.has(settings.noteOrder as string)
  )
    delete settings.noteOrder
  return Object.keys(settings).length > 0
    ? (settings as ProjectSettings)
    : undefined
}

/**
 * Parse an exported JSON document back into a Project (fresh id, no owner —
 * the caller decides where it lands). Throws an Error whose message is
 * user-facing when the file isn't a readable Sound Annotator export.
 */
export function parseProjectJson(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("that file isn't valid JSON.")
  }
  if (
    !raw ||
    typeof raw !== 'object' ||
    (raw as Record<string, unknown>).format !== PROJECT_JSON_FORMAT
  ) {
    throw new Error("that file doesn't look like a Sound Annotator track export.")
  }
  const envelope = raw as Record<string, unknown>
  const version = num(envelope.version) ?? 0
  if (version > PROJECT_JSON_VERSION) {
    throw new Error(
      'this export came from a newer version of Sound Annotator — refresh the app and try again.',
    )
  }
  const data =
    envelope.project && typeof envelope.project === 'object'
      ? (envelope.project as Record<string, unknown>)
      : {}

  const annotations = Array.isArray(data.annotations)
    ? data.annotations
        .map(sanitizeAnnotation)
        .filter((a): a is Annotation => a !== null)
    : []
  // Note ids must be unique — @mentions link notes by id, and React keys on it.
  // A corrupted file with duplicates keeps the first and re-mints the rest.
  const seen = new Set<string>()
  for (const a of annotations) {
    if (seen.has(a.id)) a.id = crypto.randomUUID()
    seen.add(a.id)
  }

  return {
    id: crypto.randomUUID(),
    title: str(data.title)?.trim() || 'Untitled track',
    source: sanitizeSource(data.source),
    annotations,
    updatedAt: Date.now(),
    settings: sanitizeSettings(data.settings),
  }
}
