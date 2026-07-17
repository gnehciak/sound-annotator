// Export a listening task to a print-ready answer sheet — the hand-in step of
// the classroom workflow: the teacher shares a track whose notes carry
// questions, students answer in the share viewer, then save this sheet as a
// PDF and hand it back.
//
// Same machinery as exportPdf.ts (no server, no PDF library): a self-contained
// HTML document opened in a new tab whose screen-only "Save as PDF" button
// triggers the print dialog; the document <title> makes the dialog suggest
// "{track} — {student}.pdf". Questions print in worksheet order with their
// timecodes and prompts; a typed answer prints as text, an empty one prints as
// ruled lines — so exporting before answering doubles as the blank paper
// worksheet.
import type { Annotation, Project } from '../types'
import { noteLabel } from './format'
import { colorForId } from './noteColors'
import { primaryTextHtml } from './noteBlocks'
import { countAnswered, questionsOf } from './questions'

/** Escape text for safe interpolation into HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** True when a prompt's HTML carries real content (text or an image). */
function htmlHasContent(html: string): boolean {
  if (/<img/i.test(html)) return true
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return (doc.body.textContent ?? '').trim().length > 0
}

/** The student's answers, as held by the share viewer (see lib/answers.ts). */
export interface AnswerSheetInput {
  name: string
  answers: Record<string, string>
}

/**
 * The document <title> — and the print dialog's suggested PDF filename. The
 * student's name goes in so a teacher's download folder sorts itself.
 */
function sheetName(project: Project, studentName: string): string {
  const track = project.title || 'Untitled track'
  const who = studentName.trim() || 'Answer sheet'
  return `${track} — ${who}`.replace(/[\\/:*?"<>|]/g, '-')
}

/** The share/view link for a project (mirrors SharePanel). */
function projectUrl(id: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?view=${id}`
}

/** The watch URL for a YouTube source. */
function youtubeUrl(source: NonNullable<Project['source']>): string {
  return source.youtubeUrl ?? `https://www.youtube.com/watch?v=${source.videoId ?? ''}`
}

function questionBlock(
  note: Annotation,
  number: number,
  answerText: string,
): string {
  const color = note.color ?? colorForId(note.id)
  const prompt = primaryTextHtml(note)
  const bar = note.bar?.trim()
  const answered = answerText.trim().length > 0
  return `<section class="q">
    <div class="q-head">
      <span class="q-num">Q${number}</span>
      <span class="time" style="border-color:${color}">${esc(
        noteLabel(note.start, note.end),
      )}</span>
      ${bar ? `<span class="q-bar">${esc(bar)}</span>` : ''}
    </div>
    ${htmlHasContent(prompt) ? `<div class="rich">${prompt}</div>` : ''}
    ${
      answered
        ? `<div class="answer">${esc(answerText.trim())}</div>`
        : '<div class="rules" aria-hidden="true"><div></div><div></div><div></div></div>'
    }
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
  .brand-bar {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 10px;
    border-bottom: 3px solid #e08a0c;
  }
  .brand, .doc-kind {
    font: 600 10px/1 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }
  .brand { color: #9a5d08; }
  .doc-kind { color: #6e6555; }
  h1 {
    margin: 20px 0 0;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.15;
    text-wrap: balance;
  }
  .meta {
    margin-top: 14px;
    padding: 12px 0;
    border-top: 1px solid #d2c9b6;
    border-bottom: 1px solid #d2c9b6;
    display: grid;
    gap: 6px;
  }
  .meta-row { display: flex; align-items: baseline; gap: 10px; }
  .meta-k {
    flex: 0 0 72px;
    font: 600 9px/1.6 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #6e6555;
  }
  .meta-v {
    font: 11px ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #44403a;
    word-break: break-all;
  }
  .meta-name { font: 600 14px/1.3 'Helvetica Neue', Arial, sans-serif; color: #1c1a16; }
  .meta-rule {
    display: inline-block;
    width: 260px;
    border-bottom: 1px solid #8f8672;
    height: 1.1em;
  }
  a.meta-v { color: #9a5d08; text-decoration: none; }
  /* Question blocks */
  .q { margin-top: 18px; break-inside: avoid; page-break-inside: avoid; }
  .q-head { display: flex; align-items: baseline; gap: 10px; }
  .q-num {
    font: 700 13px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    letter-spacing: 0.06em;
    color: #9a5d08;
  }
  .time {
    display: inline-block;
    padding-left: 8px;
    border-left: 3px solid #ccc;
    font: 600 12px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    white-space: nowrap;
  }
  .q-bar {
    font: 600 10px/1.4 ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    color: #6e6555;
  }
  .q .rich { margin-top: 6px; font-size: 13px; }
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
  .rich img { max-width: 100%; height: auto; border-radius: 4px; margin: 4px 0; }
  .note-mention {
    font-weight: 600;
    color: #9a5d08;
    background: #f5ecd9;
    padding: 0 4px;
    border-radius: 3px;
  }
  /* The student's answer — typed text, kept exactly as written. */
  .answer {
    margin-top: 8px;
    padding: 9px 11px;
    border: 1px solid #d2c9b6;
    border-left: 3px solid #e08a0c;
    border-radius: 4px;
    background: #faf7f0;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }
  /* Unanswered: ruled lines to handwrite on (also the blank worksheet). */
  .rules { margin-top: 6px; }
  .rules div { height: 26px; border-bottom: 1px solid #b8ae98; }
  .empty {
    margin: 18px 0;
    padding: 20px;
    text-align: center;
    color: #6e6555;
    border: 1px dashed #d2c9b6;
    border-radius: 6px;
  }
  /* Screen-only chrome — mirrors the notes report: paper on a warm desk. */
  @media screen {
    html { background: #e9e2d2; }
    body {
      max-width: 780px;
      min-height: 100vh;
      margin: 0 auto;
      padding: 52px 56px 64px;
      box-shadow: 0 0 0 1px #d2c9b6, 0 18px 48px rgba(28, 26, 22, 0.18);
    }
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

/** Build the full, self-contained answer-sheet document. */
export function buildAnswerSheetHtml(
  project: Project,
  input: AnswerSheetInput,
): string {
  const questions = questionsOf(project.annotations)
  const answered = countAnswered(questions, input.answers)
  const name = input.name.trim()

  const source = project.source
  const sourceRow =
    source?.type === 'youtube' && (source.videoId || source.youtubeUrl)
      ? `<div class="meta-row"><span class="meta-k">YouTube</span><a class="meta-v" href="${esc(
          youtubeUrl(source),
        )}">${esc(youtubeUrl(source))}</a></div>`
      : source?.type === 'audio' && source.fileName
        ? `<div class="meta-row"><span class="meta-k">Audio file</span><span class="meta-v">${esc(
            source.fileName,
          )}</span></div>`
        : ''

  // en-GB pins "17 July 2026" — the sheet chrome is hardcoded English.
  const exported = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  const body = questions.length
    ? questions
        .map((q, i) => questionBlock(q, i + 1, input.answers[q.id] ?? ''))
        .join('')
    : '<p class="empty">This track has no questions.</p>'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(sheetName(project, name))}</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="print-bar">
    <button type="button" onclick="window.print()" title="Print → Save as PDF (⌘P)">Save as PDF</button>
  </div>
  <div class="brand-bar">
    <span class="brand">◉ Sound Annotator</span>
    <span class="doc-kind">Listening task</span>
  </div>
  <h1>${esc(project.title || 'Untitled track')}</h1>
  <div class="meta">
    <div class="meta-row"><span class="meta-k">Name</span>${
      name
        ? `<span class="meta-name">${esc(name)}</span>`
        : '<span class="meta-rule"></span>'
    }</div>
    <div class="meta-row"><span class="meta-k">Date</span><span class="meta-v">${esc(
      exported,
    )}</span></div>
    ${sourceRow}
    <div class="meta-row"><span class="meta-k">Task</span><a class="meta-v" href="${esc(
      projectUrl(project.id),
    )}">${esc(projectUrl(project.id))}</a></div>
    <div class="meta-row"><span class="meta-k">Answered</span><span class="meta-v">${answered} of ${
      questions.length
    }</span></div>
  </div>
  ${body}
</body>
</html>`
}

/**
 * Open the answer sheet in a new tab, ready to save as a PDF (mirrors
 * exportProjectPdf — the tab's button or ⌘P; the title names the file).
 */
export function exportAnswerSheetPdf(
  project: Project,
  input: AnswerSheetInput,
): void {
  if (typeof window === 'undefined') return
  const blob = new Blob([buildAnswerSheetHtml(project, input)], {
    type: 'text/html',
  })
  const url = URL.createObjectURL(blob)
  const tab = window.open(url, '_blank')
  if (!tab) {
    URL.revokeObjectURL(url)
    alert('The sheet was blocked — allow pop-ups for this site and try again.')
    return
  }
  // The URL only needs to outlive the navigation (generous margin).
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
