// Export a project to a print-ready document the browser turns into a PDF.
//
// No server and no PDF library: we build a self-contained HTML document (inline
// styles, note images referenced by their Cloud Storage URLs) and open it in a
// new tab, where a screen-only "Save as PDF" button triggers the browser's
// print dialog. The document's <title> is the track title, so the dialog
// suggests "{track}.pdf" as the filename. The document is a light, paper-styled
// report. Page 1 is a cover: brand bar, title, video thumbnail, and a keyed
// meta block (source / project link / note count / annotated range / export
// date) pinned to the page foot. The notes start on page 2 as a Time / Tags /
// Content table. Rich-text notes render as-is (TipTap HTML, including pasted
// images); musical-elements (and any future window plugin) blocks render as a
// labelled spec line beneath the text.
import type { Annotation, Project } from '../types'
import { formatTime, noteLabel } from './format'
import { resolveTag, tagsOf } from './tags'
import { colorForId } from './noteColors'
import { blocksOf, primaryTextHtml, TEXT_BLOCK } from './noteBlocks'
import { getPlugin } from './notePlugins'
import { layerOf, summarizeElements, type ElementsData } from './musicElements'

/** Escape text for safe interpolation into HTML (note bodies are inserted raw). */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Same-time tiebreak used by the notes list: manual order, then creation. */
function tie(a: Annotation, b: Annotation): number {
  if (a.order != null && b.order != null) return a.order - b.order
  if (a.order != null) return -1
  if (b.order != null) return 1
  return a.createdAt - b.createdAt
}

/** True when a note's text HTML carries real content (text or an image). */
function htmlHasContent(html: string): boolean {
  if (/<img/i.test(html)) return true
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').trim().length > 0
}

/** Labelled spec lines for a note's non-text blocks (elements, future plugins). */
function specLines(note: Annotation): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = []
  for (const block of blocksOf(note)) {
    if (block.type === TEXT_BLOCK) continue
    if (block.type === 'elements') {
      const data = (block.data as ElementsData) ?? { fields: {} }
      const layer = layerOf(data.layer)
      const summary = summarizeElements(data)
      const parts: string[] = []
      if (layer) parts.push(layer.label)
      if (summary) parts.push(summary)
      if (parts.length) out.push({ label: 'Musical elements', text: parts.join(' · ') })
      continue
    }
    const plugin = getPlugin(block.type)
    const text = plugin?.summarize?.(block.data)?.trim()
    if (text) out.push({ label: plugin?.label ?? block.type, text })
  }
  return out
}

/**
 * The export document's <title>: the tab name, and what print dialogs suggest
 * as the PDF filename ("{title}.pdf") — scrub filesystem-hostile characters.
 */
function exportName(project: Project): string {
  return (project.title || 'Untitled track').replace(/[\\/:*?"<>|]/g, '-')
}

/** The read-only share/view link for a project (mirrors SharePanel). */
function projectUrl(id: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?view=${id}`
}

/** The watch URL for a YouTube source. */
function youtubeUrl(source: NonNullable<Project['source']>): string {
  return source.youtubeUrl ?? `https://www.youtube.com/watch?v=${source.videoId ?? ''}`
}

function tagsCell(note: Annotation): string {
  const tags = tagsOf(note)
  if (tags.length === 0) return '<span class="muted">—</span>'
  return tags
    .map((t) => {
      const r = resolveTag(t)
      if (!r) return ''
      return `<span class="tag" style="border-color:${r.color};background:${r.color}1f">${esc(r.label)}</span>`
    })
    .join('')
}

function contentCell(note: Annotation): string {
  const html = primaryTextHtml(note)
  const specs = specLines(note)
  const text = htmlHasContent(html) ? `<div class="rich">${html}</div>` : ''
  const specHtml = specs.length
    ? `<div class="specs">${specs
        .map(
          (s) =>
            `<div class="spec"><span class="spec-k">${esc(s.label)}</span><span>${esc(s.text)}</span></div>`,
        )
        .join('')}</div>`
    : ''
  if (!text && !specHtml) return '<span class="muted">—</span>'
  return text + specHtml
}

function tableRow(note: Annotation): string {
  const color = note.color ?? colorForId(note.id)
  return `<tr>
    <td class="c-time"><span class="time" style="border-color:${color}">${esc(
      noteLabel(note.start, note.end),
    )}</span></td>
    <td class="c-tags">${tagsCell(note)}</td>
    <td class="c-content">${contentCell(note)}</td>
  </tr>`
}

/** The span the notes cover, e.g. "0:00–15:42" (one timecode for one moment). */
function noteRange(notes: Annotation[]): string {
  if (notes.length === 0) return ''
  const first = notes[0].start
  const last = Math.max(...notes.map((n) => n.end ?? n.start))
  return last > first ? `${formatTime(first)}–${formatTime(last)}` : formatTime(first)
}

/**
 * Page 1: a full-page cover. Brand bar with the amber signal rule, the title
 * at display scale, the thumbnail, and a keyed meta block pinned to the page
 * foot. `min-height: 96vh` + `break-after: page` fills the first sheet and
 * pushes the notes table to page 2.
 */
function coverBlock(project: Project, notes: Annotation[]): string {
  const source = project.source
  const link = projectUrl(project.id)
  // Thumbnail: YouTube poster, or a glyph banner for audio tracks that have
  // no artwork.
  let thumb = ''
  let sourceRow = ''
  if (source?.type === 'youtube' && source.videoId) {
    const id = source.videoId
    // hqdefault always exists (so it's reliably there by the time the user
    // prints); it's 4:3 with letterbox bars, which the 16:9 cover-crop
    // wrapper trims off.
    thumb = `<div class="thumb-wrap"><img class="thumb" alt="Video thumbnail"
      src="https://img.youtube.com/vi/${id}/hqdefault.jpg" /></div>`
    const url = youtubeUrl(source)
    sourceRow = `<div class="link-row"><span class="link-k">YouTube</span><a class="link-v" href="${esc(
      url,
    )}">${esc(url)}</a></div>`
  } else if (source?.type === 'audio') {
    const name = source.fileName || 'Audio track'
    thumb = `<div class="thumb-audio"><span class="glyph">♪</span><span class="thumb-name">${esc(
      name,
    )}</span></div>`
    sourceRow = `<div class="link-row"><span class="link-k">Audio file</span><span class="meta-v">${esc(
      name,
    )}</span></div>`
  }

  const range = noteRange(notes)
  // en-GB pins "6 June 2026": the document chrome (NOTES / RANGE / EXPORTED)
  // is hardcoded English, so a system-locale date would read mixed-language.
  const exported = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return `<section class="cover">
    <div class="cover-brand"><div class="brand">◉ Sound Annotator</div></div>
    <h1>${esc(project.title || 'Untitled track')}</h1>
    ${thumb}
    <div class="cover-meta">
      ${sourceRow}
      <div class="link-row"><span class="link-k">Project</span><a class="link-v" href="${esc(
        link,
      )}">${esc(link)}</a></div>
      <div class="link-row"><span class="link-k">Notes</span><span class="meta-v">${notes.length}</span></div>
      ${range ? `<div class="link-row"><span class="link-k">Range</span><span class="meta-v">${esc(range)}</span></div>` : ''}
      <div class="link-row"><span class="link-k">Exported</span><span class="meta-v">${esc(exported)}</span></div>
    </div>
  </section>`
}

const STYLES = `
  @page { margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 13px/1.55 'Helvetica Neue', Arial, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #1c1a16;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .brand {
    font: 600 10px/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: #9a5d08;
  }
  /* Cover page: fills the first sheet (96vh leaves slack so the forced break
     never spills a near-empty second cover page) and pins the meta block to
     the foot with margin-top: auto. */
  .cover {
    display: flex;
    flex-direction: column;
    min-height: 96vh;
    break-after: page;
    page-break-after: always;
  }
  .cover-brand {
    padding-bottom: 10px;
    border-bottom: 3px solid #e08a0c;
  }
  h1 {
    margin: 64px 0 0;
    font-size: 32px;
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.12;
    text-wrap: balance;
  }
  .thumb-wrap {
    width: 100%;
    max-width: 600px;
    margin-top: 28px;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 6px;
    border: 1px solid #d2c9b6;
    background: #000;
  }
  .thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb-audio {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    max-width: 600px;
    margin-top: 28px;
    padding: 22px 18px;
    border-radius: 6px;
    border: 1px solid #d2c9b6;
    background: #f5f1e8;
  }
  .thumb-audio .glyph { font-size: 30px; color: #9a5d08; line-height: 1; }
  .thumb-name {
    font: 12px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #6e6555;
    word-break: break-all;
  }
  .cover-meta {
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid #d2c9b6;
    display: grid;
    gap: 5px;
  }
  .link-row { display: flex; align-items: baseline; gap: 10px; }
  .link-k {
    flex: 0 0 64px;
    font: 600 9px/1.6 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6e6555;
  }
  .link-v {
    font: 11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #9a5d08;
    word-break: break-all;
    text-decoration: none;
  }
  .meta-v {
    font: 11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #44403a;
    word-break: break-all;
  }
  .report-title {
    font-size: 13px;
    font-weight: 600;
    color: #6e6555;
  }
  .report-title + .section { margin-top: 6px; }
  .section {
    margin: 22px 0 8px;
    padding-bottom: 6px;
    border-bottom: 2px solid #e08a0c;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }
  .section h2 {
    margin: 0;
    font: 600 11px/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .section .count {
    font: 10px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #6e6555;
  }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th {
    text-align: left;
    padding: 0 10px 6px;
    font: 600 9px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6e6555;
    border-bottom: 1px solid #d2c9b6;
  }
  td {
    padding: 9px 10px;
    vertical-align: top;
    border-bottom: 1px solid #e7e0d2;
  }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .col-time { width: 78px; }
  .col-tags { width: 132px; }
  .time {
    display: inline-block;
    padding-left: 8px;
    border-left: 3px solid #ccc;
    font: 600 12px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    white-space: nowrap;
  }
  .tag {
    display: inline-block;
    margin: 0 4px 4px 0;
    padding: 1px 7px;
    border-radius: 999px;
    border: 1px solid #ccc;
    font: 600 9px/1.6 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #2a2620;
    white-space: nowrap;
  }
  .muted { color: #a89e8a; }
  .rich { font-size: 13px; }
  .rich > :first-child { margin-top: 0; }
  .rich > :last-child { margin-bottom: 0; }
  .rich p { margin: 0 0 6px; }
  .rich ul, .rich ol { margin: 4px 0 6px; padding-left: 20px; }
  .rich li { margin: 1px 0; }
  .rich h1, .rich h2, .rich h3 { margin: 8px 0 4px; font-size: 14px; }
  .rich blockquote {
    margin: 6px 0;
    padding-left: 10px;
    border-left: 2px solid #d2c9b6;
    color: #6e6555;
  }
  .rich code {
    font: 12px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    background: #f1ece1;
    padding: 0 3px;
    border-radius: 3px;
  }
  .rich a { color: #9a5d08; }
  .rich img {
    max-width: 100%;
    height: auto;
    border-radius: 4px;
    margin: 4px 0;
  }
  .rich img[data-align='center'] { display: block; margin-left: auto; margin-right: auto; }
  .rich img[data-align='right'] { display: block; margin-left: auto; }
  .note-mention {
    font-weight: 600;
    color: #9a5d08;
    background: #f5ecd9;
    padding: 0 4px;
    border-radius: 3px;
  }
  .specs { margin-top: 6px; display: grid; gap: 3px; }
  .spec {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 12px;
    color: #44403a;
  }
  .spec-k {
    flex: 0 0 auto;
    font: 600 8px/1.6 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6e6555;
  }
  .empty {
    margin: 18px 0;
    padding: 20px;
    text-align: center;
    color: #6e6555;
    border: 1px dashed #d2c9b6;
    border-radius: 6px;
  }
  /* Screen-only chrome — the report opens in a tab and printing is user-
     initiated. Render as a paper sheet on a warm desk, with a fixed
     Save-as-PDF button; none of it survives into the print itself. */
  @media screen {
    html { background: #e9e2d2; }
    body {
      max-width: 860px;
      min-height: 100vh;
      margin: 0 auto;
      padding: 52px 56px 64px;
      box-shadow: 0 0 0 1px #d2c9b6, 0 18px 48px rgba(28, 26, 22, 0.18);
    }
    /* On screen there are no sheets to fill — let the cover hug its content. */
    .cover { min-height: 0; margin-bottom: 48px; }
    .cover-meta { margin-top: 28px; }
  }
  .print-bar { position: fixed; top: 14px; right: 14px; }
  .print-bar button {
    padding: 9px 16px;
    border: 0;
    border-radius: 5px;
    background: #e08a0c;
    color: #1c1a16;
    font: 600 11px/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(28, 26, 22, 0.3);
  }
  .print-bar button:hover { background: #c97c0a; }
  @media print { .print-bar { display: none; } }
`

/** Build the full, self-contained print document for a project. */
export function buildExportHtml(project: Project): string {
  const notes = [...project.annotations].sort((a, b) => a.start - b.start || tie(a, b))
  const count = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`

  const body = notes.length
    ? `<table>
        <thead>
          <tr>
            <th class="col-time">Time</th>
            <th class="col-tags">Tags</th>
            <th class="col-content">Content</th>
          </tr>
        </thead>
        <tbody>${notes.map(tableRow).join('')}</tbody>
      </table>`
    : '<p class="empty">No notes in this track yet.</p>'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(exportName(project))}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="print-bar">
    <button type="button" onclick="window.print()" title="Print → Save as PDF (⌘P)">Save as PDF</button>
  </div>
  ${coverBlock(project, notes)}
  <div class="report-title">${esc(project.title || 'Untitled track')}</div>
  <div class="section"><h2>Notes</h2><span class="count">${count}</span></div>
  ${body}
</body>
</html>`
}

/**
 * Export a project to PDF: open the print-ready report in a new tab (no print
 * dialog is forced). The user saves it from there — the in-page "Save as PDF"
 * button or ⌘P — and the document title makes the dialog suggest
 * "{track title}.pdf". No-op without a window (SSR safety).
 */
export function exportProjectPdf(project: Project): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([buildExportHtml(project)], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const tab = window.open(url, '_blank')
  if (!tab) {
    URL.revokeObjectURL(url)
    alert('The report tab was blocked — allow pop-ups for this site and try again.')
    return
  }
  // The tab keeps its document after revocation; the URL only needs to outlive
  // the navigation (generous, so a slow tab spin-up can't lose the report).
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
