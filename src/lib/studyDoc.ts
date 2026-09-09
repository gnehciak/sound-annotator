// The **study-notes document**: what a track's notes look like once they leave
// the app as a file.
//
// One model, two renderers — lib/exportPdf.ts writes it as a PDF, and
// lib/exportDocx.ts as a .docx. That split is deliberate: the two formats are
// laid out by completely different machinery (a page-and-coordinates engine
// against a flow of XML paragraphs), and the one thing they must never
// disagree about is *what the document says*. Anything either of them decides
// on its own is a rendering decision; anything about the content belongs here.
//
// The shape is the marking-guide grid a music teacher works in — an element
// heading over a table of examples and analysis — **carrying this app's own
// structure** rather than a blank template's:
//
//  - **time is the first column**, because a timecode is this app's primary
//    coordinate: everything in a track is anchored to a moment, and a study
//    note nobody can find in the recording is half a note. The bar or
//    rehearsal mark rides with it, and a note that is a question says so.
//  - **the example is the score quote**, captioned with the page of the score
//    it was cut from.
//  - **the element grouping is the app's own vocabulary**: a note is filed
//    under its first inline property tag (`Timbre / Bright`), which is the
//    same concept list the `@` menu and the dictionary offer.
//  - **sections come first and separately**. A note marked as structure
//    brackets a span of the music, which is what the song-structure board
//    *is*; printed among the elements it would read as one more observation
//    instead of the frame the others sit inside.
//
// The analysis column is the note's own words and nothing else. The guide's
// *What / Why* prompts were tried and dropped: the app has nothing to put
// under either, so they printed as two labels around one paragraph and a gap —
// scaffolding for writing that had already been done. What the note was filed
// as still rides above it as a strapline, because that the app does know. The
// .docx is where the rest gets written, and a heading nobody asked for is not
// what makes that possible.
import type { Annotation, Project } from '../types'
import { formatTime, noteLabel, notePlainText } from './format'
import { blocksOf, primaryTextHtml, TEXT_BLOCK } from './noteBlocks'
import { getPlugin } from './notePlugins'
import { layerOf, summarizeElements, type ElementsData } from './musicElements'
import { hueFor, inkFor, propertyTagsInHtml } from './propertyTags'
import { resolveTag, tagsOf } from './tags'
import { colorForId, hueText } from './noteColors'
import { isVideoSource, sourceLabel, sourceLinkUrl } from './source'
import { quoteOf, quotePageOf } from './overlays'
import { scoreLabel } from './score'
import { publicId } from './ids'
import type { QuoteImage } from './quoteImages'

/** The column headings of every element table. */
export const WHERE_HEADING = 'Where'
export const EXAMPLE_HEADING = 'Example (drawing or quotation)'
export const ANALYSIS_HEADING = 'Analysis'

/** The heading above each table, minus the group's own name. */
export const GROUP_PREFIX = 'Element(s) / Sub Element(s)'

/** Where a note with no element tags is filed. */
export const UNGROUPED = 'Ungrouped'

/** The section table's own headings. */
export const SECTIONS_HEADING = 'Structure'
export const SECTION_COLS = ['Section', 'Span', 'Notes'] as const

/**
 * A stretch of text with one appearance — the unit both renderers draw.
 *
 * A note's prose is written in a rich-text editor, and flattening it to a
 * string on the way out loses exactly the part the writer used to *mean*
 * something: the emphasis, and the coloured chips that say which concept a
 * word is. So the document carries runs, and each renderer maps them onto its
 * own idea of a styled span — pdf-lib picks a font and paints a ground,
 * Word gets a `w:rPr`.
 */
export interface DocRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Monospaced — `code` in the editor. */
  mono?: boolean
  /** Ink, `#rrggbb`. Absent is the document's own body colour. */
  color?: string
  /** A chip's ground, `#rrggbb` — an inline property tag or a note reference. */
  fill?: string
}

/** A picture pasted into the note itself, as the editor stored it. */
export interface DocImage {
  /** The hosted note-image URL; resolved to bytes at export (lib/quoteImages). */
  src: string
  /** The width the writer dragged it to, in CSS pixels. Absent means natural. */
  width?: number
  align?: 'left' | 'center' | 'right'
}

/** One line of prose: its runs, and what kind of line it is. */
export interface DocBlock {
  runs: DocRun[]
  kind: 'p' | 'heading' | 'quote' | 'image'
  /** The picture, on an `image` block. Its `runs` are empty. */
  image?: DocImage
  /**
   * A list item's bullet or number, drawn in the margin. Lists are rendered as
   * marked paragraphs rather than as real lists, deliberately: Word's are a
   * numbering part of their own, and a bullet that is simply *there* survives
   * both renderers and every copy-paste out of them.
   */
  marker?: string
}

/** A coloured badge in the strapline: a tag, or a concept the note names. */
export interface DocBadge {
  label: string
  /** AA-safe on white paper — every hue here has been through `hueText`. */
  color: string
}

/** One structural note: a named span of the music. */
export interface StudySection {
  name: string
  span: string
  text: string
}

/** One note, as a row of an element table. */
export interface StudyRow {
  id: string
  /**
   * The *Where* column, one line each: the timecode, then the bar or
   * rehearsal mark. Time first because that is how anything in this app is
   * found again.
   */
  where: string[]
  /** The note's own hue, which marks its row the way it marks its row in app. */
  color: string
  /** Short badges above the analysis — "Question", and the note's tags. */
  flags: DocBadge[]
  /** The score quote, if the note has one that could be resolved. */
  quote?: QuoteImage
  /** Where the picture was cut from — "Page 3 of the score". */
  quoteFrom: string
  /** The note's own prose, as written — the analysis column. */
  analysis: DocBlock[]
  /** Its inline property tags, spelled out — "Timbre: Bright", in their hues. */
  properties: DocBadge[]
  /** Anything a block plugin summarises, plus an elements block if it has one. */
  spec: string
  /** The note's lyric line, when it carries one. */
  lyrics?: string
}

/** A table: the notes filed under one element / sub-element. */
export interface StudyGroup {
  label: string
  rows: StudyRow[]
}

export interface StudyDoc {
  title: string
  /** The keyed block under the title — source, score, link, count, range. */
  meta: { key: string; value: string }[]
  /** The structural spine, when the track has one. Printed before the grid. */
  sections: StudySection[]
  groups: StudyGroup[]
}

/** Same-time tiebreak used by the notes list: manual order, then creation. */
function tie(a: Annotation, b: Annotation): number {
  if (a.order != null && b.order != null) return a.order - b.order
  if (a.order != null) return -1
  if (b.order != null) return 1
  return a.createdAt - b.createdAt
}

/**
 * Which element a note is filed under: its first inline property tag, read as
 * `Element / Sub-element`. Deliberately the *first* rather than all of them —
 * a note belongs in one place in a set of study notes, and the rest are still
 * printed in the row itself.
 */
function groupOf(note: Annotation): string {
  const tag = propertyTagsInHtml(primaryTextHtml(note))[0]
  if (!tag) return UNGROUPED
  return tag.category ? `${tag.category} / ${tag.value}` : tag.value
}

/** The app's signal hue, for the one badge that isn't a tag or a concept. */
const SIGNAL = '#e08a0c'

/** A link's ink, and a note reference's — the one warm accent on paper. */
const LINK_INK = '#9a5d08'
const MENTION_FILL = '#f5ecd9'

/** A hue laid over white at `amount`, as the faint ground a chip wears. */
function tint(hex: string, amount = 0.13): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#f1efe9'
  const n = parseInt(m[1], 16)
  const mix = (c: number) => Math.round(255 - (255 - c) * amount)
  const out =
    (mix((n >> 16) & 255) << 16) | (mix((n >> 8) & 255) << 8) | mix(n & 255)
  return `#${out.toString(16).padStart(6, '0')}`
}

/** Read an `<img>` back into the shape the renderers want. */
function imageOf(el: HTMLElement): DocImage {
  const width = Number(el.getAttribute('width'))
  const align = el.getAttribute('data-align')
  return {
    src: el.getAttribute('src') ?? '',
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(align === 'center' || align === 'right' ? { align } : {}),
  }
}

/**
 * Every note image a project's prose references — what the export has to fetch
 * before it can draw anything. Distinct from `coverUrls`, which walks the
 * *overlay*: this is the pictures that are in the writing.
 */
export function noteImageUrls(project: Project): string[] {
  const seen = new Set<string>()
  for (const note of project.annotations) {
    const html = primaryTextHtml(note)
    if (!html.includes('<img')) continue
    const doc = new DOMParser().parseFromString(html, 'text/html')
    for (const img of doc.querySelectorAll('img')) {
      const src = img.getAttribute('src')
      if (src) seen.add(src)
    }
  }
  return [...seen]
}

/** Which block a tag name is, if any. */
function blockKind(tag: string): DocBlock['kind'] | null {
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'blockquote') return 'quote'
  if (tag === 'p' || tag === 'li' || tag === 'pre' || tag === 'div') return 'p'
  return null
}

/**
 * Read a note's rich text into runs, keeping what the writer used to mean
 * something: emphasis, and the coloured chips that say which concept a word is.
 *
 * The chips are the point. An inline property tag is a *claim about the music*
 * made in the middle of a sentence, and a study document that prints it as an
 * ordinary word has thrown away the one thing distinguishing "bright" the
 * adjective from Bright the timbre. So they come out as they look on paper in
 * the app's own print stylesheet: the hue at 13% over white, AA-safe ink, and
 * the concept spelled out after the value, because paper has no hover and a
 * colour alone means nothing without a legend.
 *
 * Images are the deliberate omission — a note's inline pictures stay in the
 * app. What a document quotes is the score quote, aimed on purpose.
 */
function richBlocks(html: string): DocBlock[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const out: DocBlock[] = []
  // Images met inside a paragraph, flushed after it (see walkInline).
  const pending: DocImage[] = []

  const walkInline = (node: Node, style: DocRun, into: DocRun[]): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ')
      if (text) into.push({ ...style, text })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toLowerCase()
    if (tag === 'br') {
      into.push({ ...style, text: ' ' })
      return
    }
    // An image inside a paragraph (pasted content, or an older note) is held
    // aside and emitted as its own block after the line it interrupted: a
    // picture is not a word, and both renderers lay it out as a block anyway.
    if (tag === 'img') {
      pending.push(imageOf(el))
      return
    }

    // A chip is an atom: it has its own ground and ink and never inherits.
    if (el.hasAttribute('data-property-tag')) {
      const field = el.getAttribute('data-field') ?? ''
      const value = el.getAttribute('data-value') ?? ''
      const category = el.getAttribute('data-category') ?? ''
      const text = el.getAttribute('data-text') || value || (el.textContent ?? '')
      into.push({
        text: category ? `${text} (${category})` : text,
        bold: true,
        color: inkFor(field, value),
        fill: tint(hueFor(field, value)),
      })
      return
    }
    if (el.classList.contains('note-mention')) {
      into.push({
        text: el.textContent ?? '',
        bold: true,
        color: LINK_INK,
        fill: MENTION_FILL,
      })
      return
    }

    const next: DocRun = { ...style }
    if (tag === 'strong' || tag === 'b') next.bold = true
    if (tag === 'em' || tag === 'i') next.italic = true
    if (tag === 'u') next.underline = true
    if (tag === 's' || tag === 'strike' || tag === 'del') next.strike = true
    if (tag === 'code') {
      next.mono = true
      next.fill = next.fill ?? '#f1efe9'
    }
    if (tag === 'a') {
      next.underline = true
      next.color = LINK_INK
    }
    for (const child of Array.from(el.childNodes)) walkInline(child, next, into)
  }

  const emit = (el: HTMLElement, kind: DocBlock['kind'], marker?: string) => {
    const runs: DocRun[] = []
    pending.length = 0
    for (const child of Array.from(el.childNodes)) {
      walkInline(child, { text: '' }, runs)
    }
    // An image lifted out of the middle of a sentence leaves the spaces that
    // were on either side of it, so a doubled gap is closed here rather than
    // being left in the prose.
    for (let i = 1; i < runs.length; i += 1) {
      if (/\s$/.test(runs[i - 1].text) && /^\s/.test(runs[i].text)) {
        runs[i] = { ...runs[i], text: runs[i].text.replace(/^\s+/, '') }
      }
    }
    // Trim the ends of the line without disturbing the spaces inside it.
    while (runs.length && !runs[0].text.trim()) runs.shift()
    while (runs.length && !runs[runs.length - 1].text.trim()) runs.pop()
    if (runs.length) {
      runs[0] = { ...runs[0], text: runs[0].text.replace(/^\s+/, '') }
      const last = runs.length - 1
      runs[last] = { ...runs[last], text: runs[last].text.replace(/\s+$/, '') }
      out.push({ runs, kind, ...(marker ? { marker } : {}) })
    }
    for (const image of pending) out.push({ runs: [], kind: 'image', image })
    pending.length = 0
  }

  const walkBlocks = (parent: ParentNode): void => {
    for (const child of Array.from(parent.children)) {
      const el = child as HTMLElement
      const tag = el.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        Array.from(el.children).forEach((li, i) =>
          emit(li as HTMLElement, 'p', tag === 'ol' ? `${i + 1}.` : '\u2022'),
        )
        continue
      }
      if (tag === 'blockquote') {
        // A quote may hold paragraphs of its own; each becomes a quoted line.
        if (el.children.length) {
          for (const inner of Array.from(el.children)) emit(inner as HTMLElement, 'quote')
        } else emit(el, 'quote')
        continue
      }
      if (tag === 'img') {
        out.push({ runs: [], kind: 'image', image: imageOf(el) })
        continue
      }
      const kind = blockKind(tag)
      if (kind) emit(el, kind)
      else walkBlocks(el)
    }
  }

  walkBlocks(doc.body)
  // No block elements at all (a bare string of HTML) — treat the lot as one.
  if (!out.length) emit(doc.body as unknown as HTMLElement, 'p')
  return out
}

/** Anything a block plugin can say about the note, as one line. */
function specOf(note: Annotation): string {
  const parts: string[] = []
  for (const block of blocksOf(note)) {
    if (block.type === TEXT_BLOCK) continue
    if (block.type === 'elements') {
      const data = (block.data as ElementsData) ?? { fields: {} }
      const layer = layerOf(data.layer)
      const summary = summarizeElements(data)
      if (layer) parts.push(layer.label)
      if (summary) parts.push(summary)
      continue
    }
    const text = getPlugin(block.type)?.summarize?.(block.data)?.trim()
    if (text) parts.push(text)
  }
  return parts.join(' · ')
}

/** Where a score quote was cut from, said in the caption under it. */
function quoteFromOf(note: Annotation): string {
  const q = quoteOf(note)
  return q ? `Page ${quotePageOf(q)} of the score` : ''
}

/** The span the notes cover, e.g. "0:00–15:42" (one timecode for one moment). */
function rangeOf(notes: Annotation[]): string {
  if (notes.length === 0) return ''
  const first = Math.min(...notes.map((n) => n.start))
  const last = Math.max(...notes.map((n) => n.end ?? n.start))
  return last > first ? `${formatTime(first)}–${formatTime(last)}` : formatTime(first)
}

/** The read-only share/view link for a project (mirrors SharePanel). */
function projectUrl(id: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?view=${id}`
}

/**
 * A filename both exporters hand their own extension to. It is what the
 * browser saves and what the document is titled, so filesystem-hostile
 * characters go.
 */
export function docName(project: Project): string {
  return (project.title || 'Untitled track').replace(/[\\/:*?"<>|]/g, '-')
}

/** Assemble the document. `quotes` is what lib/quoteImages resolved. */
export function buildStudyDoc(
  project: Project,
  quotes: Map<string, QuoteImage> = new Map(),
): StudyDoc {
  const notes = [...project.annotations].sort((a, b) => a.start - b.start || tie(a, b))

  // Structure notes are the frame the rest sit inside, so they come out of the
  // grid and into their own table. On a song-structure board that is every
  // note, and the document becomes the section timeline it should be.
  const sections: StudySection[] = notes
    .filter((n) => n.structure)
    .map((n) => ({
      name: n.sectionName?.trim() || notePlainText(primaryTextHtml(n)) || 'Section',
      span: noteLabel(n.start, n.end),
      text: n.sectionName?.trim() ? notePlainText(primaryTextHtml(n)) : '',
    }))

  // Insertion order is time order, since the notes are already sorted — so the
  // groups come out in the order the music introduces them, which beats
  // alphabetical for something read alongside a recording. "Ungrouped" is
  // pushed last wherever it falls: it is the leftovers, not a topic.
  const groups = new Map<string, StudyRow[]>()
  for (const note of notes) {
    if (note.structure) continue
    const bar = note.bar?.trim()
    const row: StudyRow = {
      id: note.id,
      where: [noteLabel(note.start, note.end), ...(bar ? [`bar ${bar}`] : [])],
      color: note.color ?? colorForId(note.id),
      flags: [
        ...(note.question ? [{ label: 'Question', color: hueText(SIGNAL, 'light') }] : []),
        ...tagsOf(note)
          .map((t) => resolveTag(t))
          .filter((t): t is { label: string; color: string } => !!t)
          .map((t) => ({ label: t.label, color: hueText(t.color, 'light') })),
      ],
      quote: quotes.get(note.id),
      quoteFrom: quoteFromOf(note),
      analysis: richBlocks(primaryTextHtml(note)),
      properties: propertyTagsInHtml(primaryTextHtml(note)).map((t) => ({
        label: t.category ? `${t.category}: ${t.value}` : t.value,
        color: inkFor(t.field, t.value),
      })),
      spec: specOf(note),
      ...(note.lyrics?.trim() ? { lyrics: note.lyrics.trim() } : {}),
    }
    const label = groupOf(note)
    const rows = groups.get(label)
    if (rows) rows.push(row)
    else groups.set(label, [row])
  }
  const ordered = [...groups.entries()]
    .map(([label, rows]) => ({ label, rows }))
    .sort((a, b) => (a.label === UNGROUPED ? 1 : b.label === UNGROUPED ? -1 : 0))

  const source = project.source
  const link = sourceLinkUrl(source)
  const score = project.settings?.score
  const meta: { key: string; value: string }[] = []
  if (isVideoSource(source) && link) meta.push({ key: sourceLabel(source), value: link })
  if (score) meta.push({ key: 'Score', value: scoreLabel(score) })
  meta.push({ key: 'Project', value: projectUrl(publicId(project)) })
  meta.push({
    key: 'Notes',
    value: `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${
      sections.length ? `, ${sections.length} sections` : ''
    }`,
  })
  const range = rangeOf(notes)
  if (range) meta.push({ key: 'Range', value: range })
  meta.push({
    key: 'Exported',
    value: new Date().toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  })

  return { title: project.title || 'Untitled track', meta, sections, groups: ordered }
}
