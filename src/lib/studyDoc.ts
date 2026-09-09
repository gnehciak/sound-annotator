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
//  - **the example is the picture quote**, captioned with where it was cut
//    from — a page of the score, or the picture.
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
import { propertyTagsInHtml } from './propertyTags'
import { resolveTag, tagsOf } from './tags'
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
  /** Short badges above the analysis — "Question", and the note's tags. */
  flags: string[]
  /** The picture quote, if the note has one that could be resolved. */
  quote?: QuoteImage
  /** Where the picture was cut from: "Page 3 of the score", or the picture. */
  quoteFrom: string
  /** The note's own prose, one string per paragraph — the analysis column. */
  analysis: string[]
  /** Its inline property tags, spelled out — "Timbre: Bright". */
  properties: string[]
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

/** A note's prose, split into paragraphs and stripped of its markup. */
function paragraphsOf(html: string): string[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks = doc.body.querySelectorAll('p, li, h1, h2, h3, h4, blockquote, pre')
  const out = blocks.length
    ? [...blocks].map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim())
    : [(doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()]
  return out.filter((line) => line.length > 0)
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

/** Where a picture quote was cut from, said in the caption under it. */
function quoteFromOf(note: Annotation): string {
  const q = quoteOf(note)
  if (!q) return ''
  return q.on === 'score' ? `Page ${quotePageOf(q)} of the score` : 'From the picture'
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
      flags: [
        ...(note.question ? ['Question'] : []),
        ...tagsOf(note)
          .map((t) => resolveTag(t)?.label)
          .filter((l): l is string => !!l),
      ],
      quote: quotes.get(note.id),
      quoteFrom: quoteFromOf(note),
      analysis: paragraphsOf(primaryTextHtml(note)),
      properties: propertyTagsInHtml(primaryTextHtml(note)).map((t) =>
        t.category ? `${t.category}: ${t.value}` : t.value,
      ),
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
