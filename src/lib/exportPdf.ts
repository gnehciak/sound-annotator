// Export a project to a print-ready document the browser turns into a PDF.
//
// No server and no PDF library: we build a self-contained HTML document (inline
// styles, note images referenced by their Cloud Storage URLs) in a hidden
// iframe, then trigger the browser's print dialog — "Save as PDF" produces the
// file. The document is a light, paper-styled report: title + video thumbnail +
// the YouTube and share links up top, then every note in a Time / Tags /
// Content table. Rich-text notes render as-is (TipTap HTML, including pasted
// images); musical-elements (and any future window plugin) blocks render as a
// labelled spec line beneath the text.
import type { Annotation, Project } from '../types'
import { noteLabel } from './format'
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

function headerBlock(project: Project): string {
  const source = project.source
  const link = projectUrl(project.id)
  // Thumbnail: YouTube poster (high-res with a graceful fallback), or a glyph
  // banner for audio tracks that have no artwork.
  let thumb = ''
  let sourceRow = ''
  if (source?.type === 'youtube' && source.videoId) {
    const id = source.videoId
    // hqdefault always exists (so it loads before the print fires); it's 4:3
    // with letterbox bars, which the 16:9 cover-crop wrapper trims off.
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
    sourceRow = `<div class="link-row"><span class="link-k">Audio file</span><span class="link-v">${esc(
      name,
    )}</span></div>`
  }

  return `<header class="head">
    <div class="brand">◉ Sound Annotator</div>
    <h1>${esc(project.title || 'Untitled track')}</h1>
    ${thumb}
    <div class="links">
      ${sourceRow}
      <div class="link-row"><span class="link-k">Project</span><a class="link-v" href="${esc(
        link,
      )}">${esc(link)}</a></div>
    </div>
  </header>`
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
  h1 {
    margin: 6px 0 14px;
    font-size: 26px;
    font-weight: 700;
    letter-spacing: -0.01em;
    line-height: 1.15;
  }
  .thumb-wrap {
    width: 100%;
    max-width: 460px;
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
    max-width: 460px;
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
  .links { margin-top: 12px; display: grid; gap: 4px; }
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
  <title>${esc(project.title || 'Untitled track')} — Sound Annotator</title>
  <style>${STYLES}</style>
</head>
<body>
  ${headerBlock(project)}
  <div class="section"><h2>Notes</h2><span class="count">${count}</span></div>
  ${body}
  <script>
    // Print once everything (incl. the thumbnail) has loaded, then tidy up the
    // hidden iframe after the dialog closes. window.onload waits for images;
    // an image 404 fires onerror (handled inline) so load still resolves.
    window.onload = function () {
      window.onafterprint = function () {
        var f = window.frameElement
        if (f && f.parentNode) f.parentNode.removeChild(f)
      }
      setTimeout(function () { window.focus(); window.print() }, 80)
    }
  </script>
</body>
</html>`
}

/**
 * Export a project to PDF via the browser's print dialog. Renders the document
 * into a hidden, same-origin iframe and prints it (the iframe removes itself
 * once the dialog closes); a long fallback timer guards against the rare browser
 * that never fires `afterprint`. No-op without a window (SSR safety).
 */
export function exportProjectPdf(project: Project): void {
  if (typeof document === 'undefined') return
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    iframe.remove()
    return
  }
  doc.open()
  doc.write(buildExportHtml(project))
  doc.close()

  // Safety net: if afterprint never fires, drop the leaked iframe much later
  // (long enough not to interrupt a still-open print dialog).
  setTimeout(() => {
    if (iframe.isConnected) iframe.remove()
  }, 600000)
}
