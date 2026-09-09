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
//
// The same change must add a row to public/track-schema.md, the published
// spec people hand to an AI assistant to author a track file. That isn't a
// courtesy: scripts/check-schema-doc.mjs runs first in `npm run build` and
// fails the deploy when the doc and src/types.ts disagree.
import type {
  Annotation,
  NoteBlock,
  NoteOverlay,
  NoteQuote,
  Project,
  ProjectScore,
  ProjectSettings,
  ProjectSource,
  ScoreMark,
  ScoreTurn,
} from '../types'
import { withBlocks } from './noteBlocks'
import { clampQuote } from './overlays'
import { parseDriveFileId } from './drive'
import { newId } from './ids'
import { MARK_COLORS, MARK_KINDS, sortTurns } from './score'

export const PROJECT_JSON_FORMAT = 'sound-annotator-project'
export const PROJECT_JSON_VERSION = 1

interface ProjectJsonEnvelope {
  format: typeof PROJECT_JSON_FORMAT
  version: number
  exportedAt: number
  // An allowlist, deliberately: identity is never exported. `id` and `alias`
  // are this installation's handles on the row — an import is a *new* project
  // and mints its own (see fromJson), so inheriting either would point two
  // projects at one link.
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
  // A clip only means anything as a forward window; anything else (negative,
  // inverted) is dropped, leaving the track the whole video. Shared by both
  // video kinds, which carry the same window.
  const clipOnto = (source: ProjectSource) => {
    const clipStart = num(s.clipStart)
    const clipEnd = num(s.clipEnd)
    if (clipStart != null && clipStart > 0) source.clipStart = clipStart
    if (clipEnd != null && clipEnd > (source.clipStart ?? 0)) source.clipEnd = clipEnd
    return source
  }
  if (s.type === 'youtube') {
    const source: ProjectSource = { type: 'youtube' }
    const youtubeUrl = str(s.youtubeUrl)
    const videoId = str(s.videoId)
    if (youtubeUrl) source.youtubeUrl = youtubeUrl
    if (videoId) source.videoId = videoId
    clipOnto(source)
    return videoId || youtubeUrl ? source : undefined
  }
  if (s.type === 'drive') {
    const source: ProjectSource = { type: 'drive' }
    const driveUrl = str(s.driveUrl)
    // The id is what the player loads, so an export missing it is unplayable
    // — re-derive it from the link rather than import a dead source.
    const driveFileId =
      str(s.driveFileId) ?? (driveUrl ? (parseDriveFileId(driveUrl) ?? undefined) : undefined)
    if (driveUrl) source.driveUrl = driveUrl
    if (driveFileId) source.driveFileId = driveFileId
    clipOnto(source)
    return driveFileId ? source : undefined
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
    blocks.push({ id: str(raw.id) ?? newId(), type, data: raw.data })
  }
  return blocks.length > 0 ? blocks : undefined
}

/** One note from the file, or null when it's beyond salvage (no valid start). */
/**
 * The note's on-video layer. `coverUrl` is kept as an ordinary string: an
 * import lands through copySharedProject, which re-uploads the image under the
 * importer's own storage (see lib/copyProject.ts) — so a file exported from
 * another account arrives pointing at bytes that still exist, and stops doing
 * so only if the original is deleted, exactly like an inline note image.
 * A pin only means anything with both coordinates, so a half-written one is
 * dropped rather than pinned to a frame corner.
 */
function sanitizeOverlay(v: unknown): NoteOverlay | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const o = v as Record<string, unknown>
  const overlay: NoteOverlay = {}
  const coverUrl = str(o.coverUrl)
  if (coverUrl) overlay.coverUrl = coverUrl
  if (o.coverFit === 'cover') overlay.coverFit = 'cover'
  const coverX = num(o.coverX)
  const coverY = num(o.coverY)
  if (coverX != null) overlay.coverX = Math.min(1, Math.max(0, coverX))
  if (coverY != null) overlay.coverY = Math.min(1, Math.max(0, coverY))
  // The two pins are independent, and each needs both of its coordinates to
  // mean anything — a half-written one is dropped rather than pinned to a
  // corner. `pinAnchor` is the shape that predates the score view, where one
  // pin carried a switch instead: a file written then still imports, its pin
  // landing on whichever of the two it actually named.
  const legacyScorePin = o.pinAnchor === 'score'
  const pinX = num(o.pinX)
  const pinY = num(o.pinY)
  if (pinX != null && pinY != null && !legacyScorePin) {
    overlay.pinX = clamp01(pinX)
    overlay.pinY = clamp01(pinY)
  }
  const scorePinX = num(o.scorePinX) ?? (legacyScorePin ? pinX : null)
  const scorePinY = num(o.scorePinY) ?? (legacyScorePin ? pinY : null)
  if (scorePinX != null && scorePinY != null) {
    overlay.scorePinX = clamp01(scorePinX)
    overlay.scorePinY = clamp01(scorePinY)
    const page = num(o.scorePinPage) ?? (legacyScorePin ? num(o.pinPage) : null)
    if (page != null && page >= 1) overlay.scorePinPage = Math.round(page)
  }
  const quote = sanitizeQuote(o.quote)
  if (quote) overlay.quote = quote
  const hold = num(o.hold)
  if (hold != null && hold > 0) overlay.hold = hold
  return Object.keys(overlay).length > 0 ? overlay : undefined
}

/**
 * A picture quote: a rectangle on the picture or on a page of the score. All
 * four numbers are needed to mean anything, so a half-written one is dropped
 * rather than guessed at, and the result is squared up by the same rule the
 * dragging obeys — inside its surface, never below MIN_QUOTE.
 */
function sanitizeQuote(v: unknown): NoteQuote | undefined {
  if (!v || typeof v !== 'object') return undefined
  const q = v as Record<string, unknown>
  const on = q.on === 'score' ? 'score' : q.on === 'video' ? 'video' : null
  const x = num(q.x)
  const y = num(q.y)
  const w = num(q.w)
  const h = num(q.h)
  if (!on || x == null || y == null || w == null || h == null) return undefined
  const page = num(q.page)
  return clampQuote({
    on,
    ...(on === 'score' && page != null && page >= 1
      ? { page: Math.round(page) }
      : {}),
    x: clamp01(x),
    y: clamp01(y),
    w: clamp01(w),
    h: clamp01(h),
  })
}

function sanitizeAnnotation(v: unknown): Annotation | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  const start = num(a.start)
  if (start == null || start < 0) return null
  const ann: Annotation = {
    id: str(a.id) ?? newId(),
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
  if (a.question === true) ann.question = true
  const overlay = sanitizeOverlay(a.overlay)
  if (overlay) ann.overlay = overlay
  const blocks = sanitizeBlocks(a.blocks)
  if (blocks) ann.blocks = blocks
  // Legacy exports (contentHtml only) get their text block here, like any read.
  return withBlocks(ann)
}

const NOTE_ORDERS = new Set(['timeline', 'auto', 'live'])
const SCORE_MODES = new Set(['off', 'score', 'overlay'])
const SCORE_FITS = new Set(['height', 'width'])

/**
 * The one settings key holding an object, so it needs its own pass — the
 * lenient primitive sweep below drops anything nested. A score that names
 * neither a Drive file nor a hosted URL can never load, so it is dropped
 * whole rather than imported as a broken attachment.
 *
 * The URL of an uploaded score survives the trip deliberately: it is public
 * (unguessable, like a note image), and copySharedProject re-uploads it under
 * the importer's own path so the copy stops depending on the exporter's bytes.
 */
function sanitizeScore(v: unknown): ProjectScore | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const raw = v as Record<string, unknown>
  const driveUrl = str(raw.driveUrl)
  // As with a Drive source, re-derive the id from the link when the export is
  // missing it — the id is what actually loads.
  const driveFileId =
    str(raw.driveFileId) ??
    (driveUrl ? (parseDriveFileId(driveUrl) ?? undefined) : undefined)
  const url = str(raw.url)
  const kind = raw.kind === 'drive' || driveFileId ? 'drive' : 'blob'

  const score: ProjectScore = { kind }
  if (kind === 'drive') {
    if (!driveFileId) return undefined
    score.driveFileId = driveFileId
    if (driveUrl) score.driveUrl = driveUrl
  } else {
    if (!url) return undefined
    score.url = url
    const fileName = str(raw.fileName)
    if (fileName) score.fileName = fileName
  }

  // 'score' and 'overlay' are the two display modes that predate the score
  // view; both still arrive in files exported before it, and both mean
  // something under the new pair of knobs — see `scoreView` in lib/score.ts.
  const mode = str(raw.mode)
  if (mode === 'score') score.mode = 'view'
  else if (mode === 'overlay') {
    score.mode = 'off'
    score.overVideo = true
  } else if (mode && SCORE_MODES.has(mode)) score.mode = mode as ProjectScore['mode']
  if (raw.overVideo === true) score.overVideo = true
  const fit = str(raw.fit)
  if (fit && SCORE_FITS.has(fit)) score.fit = fit as ProjectScore['fit']
  const opacity = num(raw.opacity)
  if (opacity != null) score.opacity = Math.min(1, Math.max(0.2, opacity))
  if (raw.onTop === true) score.onTop = true
  const turns = sanitizeTurns(raw.turns)
  if (turns) score.turns = turns
  const marks = sanitizeMarks(raw.marks)
  if (marks) score.marks = marks
  return score
}

/**
 * Page turns, re-sorted on the way in: every reader of the list assumes time
 * order (the page lookup binary-searches it), and a hand-edited export is
 * exactly where that would stop being true. Entries missing a usable time or
 * page are dropped individually — one bad turn shouldn't cost the rest.
 */
function sanitizeTurns(v: unknown): ScoreTurn[] | undefined {
  if (!Array.isArray(v)) return undefined
  const turns: ScoreTurn[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const t = num((raw as Record<string, unknown>).t)
    const page = num((raw as Record<string, unknown>).page)
    if (t == null || t < 0 || page == null || page < 1) continue
    turns.push({ t, page: Math.round(page) })
  }
  return turns.length > 0 ? sortTurns(turns) : undefined
}

/**
 * The marks drawn on the score. Every coordinate is a fraction of the page, so
 * everything is clamped to 0–1 on the way in — except an arrow's `w`/`h`,
 * which are a direction rather than a size and are allowed to be negative.
 *
 * A mark with an unknown kind is dropped rather than coerced: there is no
 * honest default shape, and a highlight silently standing in for something
 * else would be worse on the page than nothing.
 */
function sanitizeMarks(v: unknown): ScoreMark[] | undefined {
  if (!Array.isArray(v)) return undefined
  const marks: ScoreMark[] = []
  for (const raw of v.slice(0, MAX_MARKS)) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    const kind = str(m.kind)
    if (!kind || !MARK_KINDS.includes(kind as ScoreMark['kind'])) continue
    const page = num(m.page)
    const x = num(m.x)
    const y = num(m.y)
    const w = num(m.w)
    const h = num(m.h)
    if (page == null || page < 1 || x == null || y == null || w == null || h == null)
      continue
    const mark: ScoreMark = {
      id: str(m.id) ?? newId(),
      page: Math.round(page),
      kind: kind as ScoreMark['kind'],
      color: str(m.color) ?? MARK_COLORS[0],
      x: clamp01(x),
      y: clamp01(y),
      // Signed for an arrow (tail → head); a size everywhere else.
      w: kind === 'arrow' ? clampSigned(w) : clamp01(w),
      h: kind === 'arrow' ? clampSigned(h) : clamp01(h),
    }
    const weight = num(m.weight)
    if (weight != null) mark.weight = Math.min(3, Math.max(1, Math.round(weight)))
    if (kind === 'ink') {
      const points = sanitizePoints(m.points)
      if (!points) continue
      mark.points = points
    }
    marks.push(mark)
  }
  return marks.length > 0 ? marks : undefined
}

/** A freehand stroke: a flat, even-length list of 0–1 fractions. */
function sanitizePoints(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length < 4) return undefined
  const points: number[] = []
  for (const n of v.slice(0, MAX_INK_POINTS * 2)) {
    const value = num(n)
    if (value == null) return undefined
    points.push(clamp01(value))
  }
  // An odd length means the pairs don't line up and every point after the gap
  // would be drawn with the wrong axis — drop the trailing half-point.
  if (points.length % 2 === 1) points.pop()
  return points.length >= 4 ? points : undefined
}

/**
 * Ceilings on what one import may carry onto a score. Both are far past any
 * real markup (a heavily annotated page runs to a few dozen marks) and exist
 * so a hand-written or generated file can't push megabytes of geometry into
 * the project's jsonb, which every save from then on would carry.
 */
const MAX_MARKS = 2000
const MAX_INK_POINTS = 2000

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
/** Signed, for the one place a fraction is a direction rather than a size. */
const clampSigned = (n: number) => Math.min(1, Math.max(-1, n))

/**
 * Settings pass through leniently: any key holding a primitive survives, so a
 * settings knob added later — including the project `kind` that makes a track
 * open as a song-structure board — round-trips without this file having to
 * know it. Only `noteOrder` is checked against its enum (an unknown value
 * would silently break the notes-list sorting); everything non-primitive
 * (nested objects, arrays) is dropped, which is why the score — the one
 * object-valued key — gets an explicit pass of its own.
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
  const score = sanitizeScore((v as Record<string, unknown>).score)
  if (score) settings.score = score
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
    if (seen.has(a.id)) a.id = newId()
    seen.add(a.id)
  }

  return {
    id: newId(),
    title: str(data.title)?.trim() || 'Untitled track',
    source: sanitizeSource(data.source),
    annotations,
    updatedAt: Date.now(),
    settings: sanitizeSettings(data.settings),
  }
}
