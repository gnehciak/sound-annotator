// Export a track's notes as a **.docx** — the same document lib/exportPdf.ts
// writes as a PDF, in the format a teacher can keep editing.
//
// That is the whole reason this exists beside the PDF rather than instead of
// it: study notes get *finished* in Word. The app knows what was quoted, where
// in the track it came from and what the teacher wrote about it; the *Why
// (effect)* half is a prompt the student types into. A PDF can't take that.
//
// Written by hand rather than through a library. A .docx is a zip of a handful
// of small XML parts, and what we emit is narrow — paragraphs, one table
// shape, inline images — so a dependency the size of a Word document model
// would buy nothing but a second way to describe the same tags. `fflate` does
// the zip, which is the one part worth not writing.
import type { Project } from '../types'
import {
  collectQuoteImages,
  quoteBytes,
  type ProgressFn,
  type QuoteImage,
} from './quoteImages'
import { openFile } from './exportPdf'
import {
  ANALYSIS_HEADING,
  buildStudyDoc,
  docName,
  EXAMPLE_HEADING,
  GROUP_PREFIX,
  SECTION_COLS,
  SECTIONS_HEADING,
  WHERE_HEADING,
  type DocBlock,
  type StudyDoc,
} from './studyDoc'

/**
 * Word measures in twips (1/20 pt) and EMU (914400 to the inch). The page is
 * A4 with 1-inch margins, so the text column is 9026 twips — which is where
 * the two column widths below come from, and why they are absolute rather
 * than percentages: Word lays a table out from the grid it is given.
 */
const TEXT_WIDTH = 9026
/**
 * Three columns: where in the track, what was quoted, and the analysis. *Where*
 * is narrow but first, because a timecode is this app's primary coordinate —
 * a study note nobody can find in the recording is half a note.
 */
const WHERE_COL = 1150
const EXAMPLE_COL = 3100
const ANALYSIS_COL = TEXT_WIDTH - WHERE_COL - EXAMPLE_COL
const CELL_MARGIN = 100
/** Room an image has inside the example cell, in EMU. */
const IMAGE_MAX_EMU = ((EXAMPLE_COL - CELL_MARGIN * 2) / 1440) * 914400
/**
 * And how tall it may be — 150pt, matching the PDF. A portrait crop off a
 * score page would otherwise be as tall as the column is wide and take a page
 * to itself; capping the height lets a wide system fill the column while a
 * tall one shrinks to fit.
 */
const IMAGE_MAX_H_EMU = (150 / 72) * 914400

/** The header row's wash, as the example document has it. */
const HEADER_FILL = 'fce5cd'

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters outright — a stray one makes the
    // file unopenable rather than ugly — so they go, matched by code point
    // rather than by a regex literal full of invisible characters.
    .replace(/./gsu, (ch) => (isXmlControl(ch) ? '' : ch))

/** True for the C0 controls XML 1.0 forbids; tab, newline and return are legal. */
function isXmlControl(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d
}

interface RunStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  mono?: boolean
  /** Half-points, as Word counts them: 18 is 9pt. */
  size?: number
  /** `RRGGBB` or `#rrggbb` — Word wants it bare, so it is stripped here. */
  color?: string
  /** Run shading, which is how a property tag keeps its ground in Word. */
  fill?: string
}

/** Word wants six bare hex digits; everything upstream carries `#rrggbb`. */
const hex6 = (c: string | undefined): string | null => {
  const m = c && /^#?([0-9a-fA-F]{6})$/.exec(c.trim())
  return m ? m[1].toUpperCase() : null
}

function run(text: string, style: RunStyle = {}): string {
  const color = hex6(style.color)
  const fill = hex6(style.fill)
  const props = [
    style.bold ? '<w:b/><w:bCs/>' : '',
    style.italic ? '<w:i/><w:iCs/>' : '',
    style.underline ? '<w:u w:val="single"/>' : '',
    style.strike ? '<w:strike/>' : '',
    style.mono
      ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>'
      : '',
    style.size ? `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>` : '',
    color ? `<w:color w:val="${color}"/>` : '',
    fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : '',
  ].join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(
    text,
  )}</w:t></w:r>`
}

/** One of the note's own lines, with every run's appearance kept. */
function block(b: DocBlock, size?: number): string {
  const runs = b.runs
    .map((r) =>
      run(r.text, {
        bold: r.bold || b.kind === 'heading',
        italic: r.italic || b.kind === 'quote',
        underline: r.underline,
        strike: r.strike,
        mono: r.mono,
        color: r.color,
        fill: r.fill,
        ...(size ? { size } : {}),
      }),
    )
    .join('')
  // Lists and quotes are marked paragraphs rather than real Word lists: a
  // numbering part is a whole extra document part to keep in step, and a
  // bullet that is simply *there* survives every copy-paste out of the file.
  const marker = b.marker ? run(`${b.marker}  `, { color: '#6E6555' }) : ''
  const indent = b.marker || b.kind === 'quote' ? '<w:ind w:left="284"/>' : ''
  const border =
    b.kind === 'quote'
      ? '<w:pBdr><w:left w:val="single" w:sz="6" w:space="6" w:color="D2C9B6"/></w:pBdr>'
      : ''
  // A document with no styles part has no space after a paragraph at all, so
  // every line of a note would run into the next one.
  const spacing = `<w:spacing w:after="${b.marker ? 40 : 90}"/>`
  return `<w:p><w:pPr>${border}${indent}${spacing}</w:pPr>${marker}${runs}</w:p>`
}

function para(
  content: string,
  opts: { centre?: boolean; spaceAfter?: number } = {},
): string {
  const props = [
    opts.centre ? '<w:jc w:val="center"/>' : '',
    opts.spaceAfter != null ? `<w:spacing w:after="${opts.spaceAfter}"/>` : '',
  ].join('')
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${content}</w:p>`
}

/** An inline picture, sized to the cell and referencing a relationship id. */
function picture(quote: QuoteImage, id: number, rel: string): string {
  let cx = Math.min(IMAGE_MAX_EMU, (quote.width / 96) * 914400)
  let cy = (cx * quote.height) / quote.width
  if (cy > IMAGE_MAX_H_EMU) {
    cy = IMAGE_MAX_H_EMU
    cx = (cy * quote.width) / quote.height
  }
  cx = Math.round(cx)
  cy = Math.round(cy)
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Picture ${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
}

function cell(width: number, body: string, fill?: string): string {
  const margin = `<w:tcMar><w:top w:type="dxa" w:w="${CELL_MARGIN}"/><w:left w:type="dxa" w:w="${CELL_MARGIN}"/><w:bottom w:type="dxa" w:w="${CELL_MARGIN}"/><w:right w:type="dxa" w:w="${CELL_MARGIN}"/></w:tcMar>`
  return `<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="${width}"/>${
    fill ? `<w:shd w:val="clear" w:fill="${fill}"/>` : ''
  }${margin}<w:vAlign w:val="top"/></w:tcPr>${body || para('')}</w:tc>`
}

/** A row of shaded column headings. */
function headerRow(labels: string[], widths: number[]): string {
  return `<w:tr>${labels
    .map((label, i) =>
      cell(widths[i], para(run(label, { bold: true }), { centre: true }), HEADER_FILL),
    )
    .join('')}</w:tr>`
}

/** A bordered table over the given column widths. */
function table(widths: number[], rows: string[]): string {
  const border = (side: string) =>
    `<w:${side} w:val="single" w:sz="8" w:color="000000"/>`
  return `<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="${widths.reduce(
    (a, b) => a + b,
    0,
  )}"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map(border)
    .join('')}</w:tblBorders></w:tblPr><w:tblGrid>${widths
    .map((w) => `<w:gridCol w:w="${w}"/>`)
    .join('')}</w:tblGrid>${rows.join('')}</w:tbl>`
}

/** Build the .docx bytes for one document. Separate from saving it, so a test
 *  can have the bytes without a window. */
export async function buildStudyDocx(doc: StudyDoc, title: string): Promise<Uint8Array> {
  const { zipSync } = await import('fflate')

  // Each distinct picture becomes one part and one relationship. Keyed by the
  // data URL, so two rows quoting the same crop embed the bytes once.
  const media = new Map<string, { rel: string; file: string; bytes: Uint8Array }>()
  const relOf = (quote: QuoteImage): string => {
    const already = media.get(quote.src)
    if (already) return already.rel
    const n = media.size + 1
    const entry = {
      rel: `rId${100 + n}`,
      file: `image${n}.jpeg`,
      bytes: quoteBytes(quote),
    }
    media.set(quote.src, entry)
    return entry.rel
  }

  const body: string[] = []
  body.push(para(run(doc.title, { bold: true, size: 40 })))
  for (const { key, value } of doc.meta) {
    body.push(
      para(
        run(`${key.toUpperCase()}   `, { bold: true, size: 16, color: '6E6555' }) +
          run(value, { size: 16, color: '6E6555' }),
        { spaceAfter: 0 },
      ),
    )
  }
  body.push(para(''))

  // The structural spine first and on its own: it is the frame the rest of the
  // notes sit inside, and on a song-structure board it is the whole document.
  if (doc.sections.length) {
    const widths = [
      Math.round(TEXT_WIDTH * 0.28),
      Math.round(TEXT_WIDTH * 0.16),
      TEXT_WIDTH - Math.round(TEXT_WIDTH * 0.28) - Math.round(TEXT_WIDTH * 0.16),
    ]
    body.push(para(run(SECTIONS_HEADING, { bold: true })))
    const rows = [headerRow([...SECTION_COLS], widths)]
    for (const section of doc.sections) {
      rows.push(
        `<w:tr>${cell(widths[0], para(run(section.name, { bold: true })))}${cell(
          widths[1],
          para(run(section.span, { color: '6E6555' })),
        )}${cell(widths[2], para(run(section.text)))}</w:tr>`,
      )
    }
    body.push(table(widths, rows), para(''))
  }

  let pictureId = 1
  for (const group of doc.groups) {
    body.push(
      para(
        run(`${GROUP_PREFIX} — `, { bold: true }) + run(group.label, { bold: true }),
      ),
    )

    const widths = [WHERE_COL, EXAMPLE_COL, ANALYSIS_COL]
    const rows: string[] = [
      headerRow([WHERE_HEADING, EXAMPLE_HEADING, ANALYSIS_HEADING], widths),
    ]

    for (const row of group.rows) {
      // Where: the timecode in bold, the bar or rehearsal mark under it.
      // The note's own hue as a rule down the timecode, which is how a note is
      // identified everywhere else in the app.
      // Indented as well as bordered: with no indent the rule sits on the
      // cell's own black border and is invisible against it.
      const rule = `<w:pBdr><w:left w:val="single" w:sz="12" w:space="4" w:color="${
        hex6(row.color) ?? 'D2C9B6'
      }"/></w:pBdr><w:ind w:left="170"/>`
      const where = row.where
        .map(
          (line, i) =>
            `<w:p><w:pPr>${rule}</w:pPr>${run(
              line,
              i === 0 ? { bold: true } : { size: 18, color: '#6E6555' },
            )}</w:p>`,
        )
        .join('')

      const example: string[] = []
      if (row.quote) {
        example.push(
          para(picture(row.quote, pictureId++, relOf(row.quote)), { centre: true }),
        )
        if (row.quoteFrom) {
          example.push(
            para(run(row.quoteFrom, { italic: true, size: 16, color: '6E6555' }), {
              centre: true,
            }),
          )
        }
      }

      const analysis: string[] = []
      // What the note was filed as, before what it says.
      const badges = [...row.flags, ...row.properties]
      if (badges.length) {
        analysis.push(
          para(
            badges
              .map(
                (badge, i) =>
                  (i ? run('  ·  ', { size: 16, color: '#9A9288' }) : '') +
                  run(badge.label, { bold: true, size: 16, color: badge.color }),
              )
              .join(''),
          ),
        )
      }
      for (const line of row.analysis) analysis.push(block(line))
      if (!row.analysis.length) analysis.push(para(''))
      if (row.lyrics) {
        analysis.push(para(run(`“${row.lyrics}”`, { italic: true, color: '6E6555' })))
      }
      if (row.spec) {
        analysis.push(para(run(row.spec, { italic: true, size: 16, color: '6E6555' })))
      }

      rows.push(
        `<w:tr>${cell(WHERE_COL, where)}${cell(EXAMPLE_COL, example.join(''))}${cell(
          ANALYSIS_COL,
          analysis.join(''),
        )}</w:tr>`,
      )
    }

    body.push(table(widths, rows), para(''))
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join(
    '',
  )}<w:sectPr><w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`

  const rels = [...media.values()]
    .map(
      (m) =>
        `<Relationship Id="${m.rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.file}"/>`,
    )
    .join('')

  const enc = new TextEncoder()
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'docProps/core.xml': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(
      title,
    )}</dc:title><dc:creator>Sound Annotator</dc:creator><cp:lastModifiedBy>Sound Annotator</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`),
    // Without a styles part Word picks its own default face and size, which
    // is how the same file comes out at 11pt Calibri here and 10pt Times
    // there. One docDefaults block settles it for every run we emit.
    'word/styles.xml': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="1C1A16"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`),
    'word/document.xml': enc.encode(document),
    'word/_rels/document.xml.rels': enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${rels}</Relationships>`),
  }
  for (const m of media.values()) files[`word/media/${m.file}`] = m.bytes

  return zipSync(files, { level: 6, mtime: new Date() })
}

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * Export a project's notes as a .docx and save it.
 *
 * Always a download, never a tab: no browser renders a Word document, so
 * opening one in a tab would offer the file for saving anyway, one step later
 * and from a page that looks like a failure.
 */
export async function exportProjectDocx(
  project: Project,
  onProgress?: ProgressFn,
): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    // Collecting the pictures is nearly all of the wall clock; writing the XML
    // is the short tail. There is no tab to show a bar in, so the button that
    // was pressed carries it.
    const quotes = await collectQuoteImages(project, (v, label) =>
      onProgress?.(v * 0.85, label),
    )
    onProgress?.(0.88, 'Writing the document')
    const name = docName(project)
    const bytes = await buildStudyDocx(buildStudyDoc(project, quotes), name)
    onProgress?.(1, 'Saving')
    openFile(bytes, DOCX_MIME, `${name}.docx`, null)
  } catch (err) {
    console.error('Word export failed:', err)
    alert("That export couldn't be built — please try again.")
  }
}
