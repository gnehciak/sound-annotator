// Export a track's notes as a **real PDF file**.
//
// It used to be an HTML report opened in a tab with a "Save as PDF" button on
// it, which put a page between the press and the document and left the result
// at the mercy of whatever the print dialog was last set to. This writes the
// PDF itself (pdf-lib, lazily imported — a track nobody exports never pays for
// it) and opens the file, so what you get is the thing you asked for.
//
// The layout is the marking-guide grid lib/studyDoc.ts describes, and every
// decision about *content* lives there: this file only knows about pages,
// columns and where the next line goes. The .docx exporter renders the same
// model, which is what keeps the two documents saying the same thing.
import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib'
import type { Project } from '../types'
import {
  collectPictures,
  quoteBytes,
  type DocPictures,
  type ProgressFn,
  type QuoteImage,
} from './quoteImages'
import type { DocRun } from './studyDoc'
import {
  ANALYSIS_HEADING,
  buildStudyDoc,
  docName,
  EXAMPLE_HEADING,
  GROUP_PREFIX,
  SECTION_COLS,
  SECTIONS_HEADING,
  WHERE_HEADING,
  type StudyDoc,
  type StudyRow,
} from './studyDoc'

/** A4 in points, and a margin the .docx matches. */
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 56

/**
 * The grid, as fractions of the text column. *Where* is narrow but first,
 * because a timecode is this app's primary coordinate; the example takes the
 * width a quoted system needs; the analysis gets the rest.
 */
const WHERE_COL = 0.13
const EXAMPLE_COL = 0.35
const ANALYSIS_COL = 1 - WHERE_COL - EXAMPLE_COL
const CELL_PAD = 7

/**
 * How tall a quoted picture may print, in points.
 *
 * The width cap is the column, but a *portrait* crop — a bar or two off a
 * score page — would then be as tall as it is wide and push one row down a
 * whole page on its own. Capping the height instead lets a wide system take
 * the full column while a tall one shrinks to fit, which is the shape a
 * quotation wants either way.
 */
const IMAGE_MAX_H = 150

/** Type sizes, in points. */
const SIZE_TITLE = 20
const SIZE_META = 8.5
const SIZE_GROUP = 10.5
const SIZE_HEAD = 8.5
const SIZE_BODY = 9.5
const SIZE_SMALL = 8

const LEADING = 1.35

/** Ink. Warm near-black on paper, with the signal amber as the one accent. */
const INK: Ink = [0.11, 0.1, 0.09]
const QUIET: Ink = [0.43, 0.4, 0.33]
const RULE: Ink = [0.72, 0.7, 0.64]
const SIGNAL: Ink = [0.88, 0.54, 0.05]
/** The header row's wash — the same one the example document uses. */
const HEADER_FILL: Ink = [0.988, 0.898, 0.804]

type Ink = readonly [number, number, number]

interface Fonts {
  body: PDFFont
  bold: PDFFont
  italic: PDFFont
  boldItalic: PDFFont
  mono: PDFFont
}

/** The face a run's marks add up to. */
function faceFor(fonts: Fonts, run: { bold?: boolean; italic?: boolean; mono?: boolean }) {
  if (run.mono) return fonts.mono
  if (run.bold && run.italic) return fonts.boldItalic
  if (run.bold) return fonts.bold
  if (run.italic) return fonts.italic
  return fonts.body
}

/**
 * A writer that owns the cursor. Every draw goes through it, so "am I off the
 * bottom of the page" is asked in one place — the mistake this kind of layout
 * code otherwise makes over and over.
 */
class Sheet {
  page: PDFPage
  y: number
  // Written out rather than declared as constructor parameters: the build
  // runs with `erasableSyntaxOnly`, which rules that shorthand out.
  private doc: PDFDocument
  private fonts: Fonts
  private rgb: (r: number, g: number, b: number) => RGB

  constructor(
    doc: PDFDocument,
    fonts: Fonts,
    rgb: (r: number, g: number, b: number) => RGB,
  ) {
    this.doc = doc
    this.fonts = fonts
    this.rgb = rgb
    this.page = doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  get width(): number {
    return PAGE_W - MARGIN * 2
  }

  /** Room left above the bottom margin. */
  get room(): number {
    return this.y - MARGIN
  }

  /** Start a new sheet. */
  break(): void {
    this.page = this.doc.addPage([PAGE_W, PAGE_H])
    this.y = PAGE_H - MARGIN
  }

  text(
    line: string,
    opts: {
      x?: number
      y?: number
      size?: number
      font?: keyof Fonts
      color?: Ink
    } = {},
  ): void {
    const size = opts.size ?? SIZE_BODY
    const [r, g, b] = opts.color ?? INK
    this.page.drawText(line, {
      x: opts.x ?? MARGIN,
      y: opts.y ?? this.y - size,
      size,
      font: this.fonts[opts.font ?? 'body'],
      color: this.rgb(r, g, b),
    })
  }

  rect(x: number, y: number, w: number, h: number, fill?: Ink, border?: Ink): void {
    this.page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      ...(fill ? { color: this.rgb(fill[0], fill[1], fill[2]) } : {}),
      ...(border
        ? { borderColor: this.rgb(border[0], border[1], border[2]), borderWidth: 0.6 }
        : {}),
    })
  }

  image(img: PDFImage, x: number, y: number, w: number, h: number): void {
    this.page.drawImage(img, { x, y, width: w, height: h })
  }

  /** pdf-lib's colour object for an ink triple — for callers drawing directly. */
  color(c: Ink): RGB {
    return this.rgb(c[0], c[1], c[2])
  }
}

/**
 * Fold `text` to `width`, breaking on spaces and, failing that, mid-word — a
 * pasted URL has no spaces in it and must not run off the page.
 */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = []
  let line = ''
  const flush = () => {
    if (line) out.push(line)
    line = ''
  }
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next
      continue
    }
    flush()
    line = word
    // A single word wider than the column is cut where it stops fitting.
    while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
      let cut = line.length - 1
      while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut -= 1
      out.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  flush()
  return out.length ? out : ['']
}

/**
 * The extra characters a PDF standard font can carry beyond ASCII and Latin-1
 * (the cp1252 window at 0x80–0x9F).
 *
 * pdf-lib *throws* on anything it can't encode rather than dropping it, so one
 * emoji in one note would fail the whole export. Note text is typed by
 * teachers and pasted from the web, so that is a matter of when, not if.
 */
const WIN_ANSI_EXTRA = new Set(
  ['€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž', '‘', '’',
   '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ'],
)

/** Drop what the font can't draw. A missing glyph reads as a limit; a wrong
 *  one reads as a bug, and a thrown error loses the whole document. */
function encodable(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13) out += ' '
    else if (code >= 32 && code <= 126) out += ch
    else if (code >= 160 && code <= 255) out += ch
    else if (WIN_ANSI_EXTRA.has(ch)) out += ch
  }
  return out
}

/** A run measured and placed on a line. */
interface Piece {
  text: string
  run: DocRun
  width: number
}

/** `#rrggbb` to the 0–1 triple pdf-lib wants. Falls back to the body ink. */
function ink(hex: string | undefined, fallback: Ink): Ink {
  const m = hex && /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/**
 * Break a paragraph of runs across `width`, greedily, keeping each word with
 * the appearance it was written in.
 *
 * Run-aware rather than string-aware because the appearance changes *inside* a
 * line: a sentence can carry a bold word and a coloured chip, and measuring the
 * whole thing in one font would wrap it in the wrong place — the more so since
 * the chips are the widest thing in the prose.
 */
function breakRuns(
  runs: DocRun[],
  fonts: Fonts,
  size: number,
  width: number,
): Piece[][] {
  const lines: Piece[][] = []
  let line: Piece[] = []
  let used = 0
  const push = () => {
    // Trailing space never counts against the margin; nor does it print.
    while (line.length && !line[line.length - 1].text.trim()) line.pop()
    if (line.length) lines.push(line)
    line = []
    used = 0
  }
  for (const run of runs) {
    const font = faceFor(fonts, run)
    // Split keeping the spaces, so "a **b** c" doesn't lose the gaps at the
    // seams between runs.
    for (const token of encodable(run.text).split(/(\s+)/)) {
      if (!token) continue
      const blank = !token.trim()
      const w = font.widthOfTextAtSize(token, size)
      if (blank) {
        // A space at a line start is dropped rather than indenting the line.
        if (line.length) {
          line.push({ text: token, run, width: w })
          used += w
        }
        continue
      }
      if (used + w > width && line.length) push()
      if (w > width) {
        // One word wider than the column: cut it where it stops fitting.
        let rest = token
        while (font.widthOfTextAtSize(rest, size) > width && rest.length > 1) {
          let cut = rest.length - 1
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) {
            cut -= 1
          }
          const head = rest.slice(0, cut)
          line.push({ text: head, run, width: font.widthOfTextAtSize(head, size) })
          push()
          rest = rest.slice(cut)
        }
        line.push({ text: rest, run, width: font.widthOfTextAtSize(rest, size) })
        used = font.widthOfTextAtSize(rest, size)
        continue
      }
      line.push({ text: token, run, width: w })
      used += w
    }
  }
  push()
  return lines.length ? lines : [[]]
}

/** One drawable line of the analysis column. */
interface Line {
  pieces: Piece[]
  size: number
  /** Space above this line, over and above the leading. */
  gap: number
  /** How far the runs sit in from the column — a list's hanging indent. */
  indent: number
  /** Drawn in that indent, at the line's start. */
  marker?: string
  /** A rule down the left, marking a quoted line. */
  rule?: boolean
  /** A picture the note itself carries, drawn instead of text on this line. */
  picture?: { image: PDFImage; width: number; height: number; offset: number }
}

/** Sizes for the kinds of block a note's prose can hold. */
const SIZE_HEADING = SIZE_BODY + 1.5
const MARKER_INDENT = 12
const QUOTE_INDENT = 9

async function analysisLines(
  row: StudyRow,
  fonts: Fonts,
  width: number,
  embed: (picture: QuoteImage) => Promise<PDFImage>,
  pictures: Map<string, QuoteImage>,
): Promise<Line[]> {
  const out: Line[] = []
  const add = (
    runs: DocRun[],
    size: number,
    gap: number,
    opts: { indent?: number; marker?: string; rule?: boolean } = {},
  ) => {
    const indent = opts.indent ?? 0
    const opening = out.length === 0
    breakRuns(runs, fonts, size, width - indent).forEach((pieces, i) => {
      out.push({
        pieces,
        size,
        // The gap belongs *between* runs, not between the wrapped lines inside
        // one: paying it per line leads a long paragraph differently from a
        // short one, which reads as an accident rather than as a space.
        gap: opening || i > 0 ? 0 : gap,
        indent,
        ...(i === 0 && opts.marker ? { marker: opts.marker } : {}),
        ...(opts.rule ? { rule: true } : {}),
      })
    })
  }

  // What the note was filed as, before what it says: a question, its tags and
  // the concepts it names are the app's own record of the note, and each keeps
  // its own hue, because that hue is what identifies it everywhere else.
  const badges = [...row.flags, ...row.properties]
  if (badges.length) {
    const runs: DocRun[] = []
    badges.forEach((badge, i) => {
      if (i) runs.push({ text: '  ·  ', color: '#9a9288' })
      runs.push({ text: badge.label, bold: true, color: badge.color })
    })
    add(runs, SIZE_SMALL, 0)
  }

  const first = badges.length ? 6 : 0
  if (row.analysis.length) {
    for (const [i, block] of row.analysis.entries()) {
      const gap = i === 0 ? first : 3
      if (block.kind === 'image') {
        const picture = block.image && pictures.get(block.image.src)
        // A picture that couldn't be fetched leaves nothing behind: a broken
        // frame in a handout is worse than a paragraph that reads without it.
        if (!picture) continue
        // The width the writer dragged it to is CSS pixels, and a point is
        // three quarters of one — the same conversion the .docx does via EMU.
        const wanted = block.image?.width ? block.image.width * 0.75 : width
        const cap = Math.min(width, wanted)
        let w = cap
        let h = (w * picture.height) / picture.width
        if (h > IMAGE_MAX_H) {
          h = IMAGE_MAX_H
          w = (h * picture.width) / picture.height
        }
        out.push({
          pieces: [],
          size: h,
          gap: out.length === 0 ? 0 : Math.max(gap, 5),
          indent: 0,
          picture: {
            image: await embed(picture),
            width: w,
            height: h,
            // Resolved here rather than at draw time, because this is the only
            // place that knows how wide the column is.
            offset:
              block.image?.align === 'center'
                ? Math.max(0, (width - w) / 2)
                : block.image?.align === 'right'
                  ? Math.max(0, width - w)
                  : 0,
          },
        })
        continue
      }
      if (block.kind === 'heading') {
        add(
          block.runs.map((r) => ({ ...r, bold: true })),
          SIZE_HEADING,
          i === 0 ? first : 7,
        )
      } else if (block.kind === 'quote') {
        add(
          block.runs.map((r) => ({ ...r, italic: true })),
          SIZE_BODY,
          gap,
          { indent: QUOTE_INDENT, rule: true },
        )
      } else if (block.marker) {
        add(block.runs, SIZE_BODY, gap, { indent: MARKER_INDENT, marker: block.marker })
      } else {
        add(block.runs, SIZE_BODY, gap)
      }
    }
  } else {
    add([{ text: '—', color: '#6e6555' }], SIZE_BODY, first)
  }

  if (row.lyrics) {
    add([{ text: `“${row.lyrics}”`, italic: true, color: '#6e6555' }], SIZE_BODY, 4)
  }
  if (row.spec) {
    add([{ text: row.spec, italic: true, color: '#6e6555' }], SIZE_SMALL, 10)
  }
  return out
}

/** Draw one laid-out line at `x`, whose baseline sits `size` below `top`. */
function drawLine(sheet: Sheet, line: Line, x: number, top: number, fonts: Fonts): void {
  if (line.picture) {
    const { image, width, height, offset } = line.picture
    sheet.image(image, x + offset, top - height, width, height)
    return
  }
  const baseline = top - line.size
  if (line.rule) {
    sheet.rect(x, baseline - line.size * 0.25, 1.5, line.size * 1.3, RULE)
  }
  if (line.marker) {
    sheet.text(line.marker, { x, y: baseline, size: line.size, color: QUIET })
  }
  let cursor = x + line.indent
  for (const piece of line.pieces) {
    const color = ink(piece.run.color, INK)
    if (piece.run.fill && piece.text.trim()) {
      // The chip's ground, as the app's own print stylesheet paints it: the
      // hue at low strength, so the word is tinted rather than boxed.
      sheet.rect(
        cursor - 1.5,
        baseline - line.size * 0.22,
        piece.width + 3,
        line.size * 1.18,
        ink(piece.run.fill, [1, 1, 1]),
      )
    }
    if (piece.text.trim()) {
      sheet.page.drawText(piece.text, {
        x: cursor,
        y: baseline,
        size: line.size,
        font: faceFor(fonts, piece.run),
        color: sheet.color(color),
      })
      if (piece.run.underline) {
        sheet.rect(cursor, baseline - line.size * 0.14, piece.width, 0.5, color)
      }
      if (piece.run.strike) {
        sheet.rect(cursor, baseline + line.size * 0.28, piece.width, 0.5, color)
      }
    }
    cursor += piece.width
  }
}

/**
 * A picture is its own height plus its gap — no leading. Leading is the room a
 * line of type needs above and below its baseline; paying it on an image just
 * puts a third of a picture's height of nothing underneath it.
 */
const advance = (l: Line): number => l.size * (l.picture ? 1 : LEADING)

const heightOf = (lines: Line[]): number =>
  lines.reduce((h, l) => h + l.gap + advance(l), 0)

/** Build the PDF bytes for one document. Separate from opening it, so a test
 *  (and any future server-side use) can have the bytes without a window. */
export async function buildStudyPdf(
  doc: StudyDoc,
  title: string,
  pictures: DocPictures = { quotes: new Map(), images: new Map() },
): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.setCreator('Sound Annotator')

  const fonts: Fonts = {
    body: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    mono: await pdf.embedFont(StandardFonts.Courier),
  }
  const sheet = new Sheet(pdf, fonts, rgb)

  // Pictures are embedded once each, however many rows point at one.
  const embedded = new Map<string, PDFImage>()
  const embed = async (quote: QuoteImage): Promise<PDFImage> => {
    const already = embedded.get(quote.src)
    if (already) return already
    const image = await pdf.embedJpg(quoteBytes(quote))
    embedded.set(quote.src, image)
    return image
  }

  // ---- masthead -----------------------------------------------------------
  sheet.text('SOUND ANNOTATOR', { size: 7.5, font: 'bold', color: SIGNAL })
  sheet.y -= 12
  sheet.rect(MARGIN, sheet.y, sheet.width, 1.6, SIGNAL)
  sheet.y -= 26

  for (const line of wrap(encodable(doc.title), fonts.bold, SIZE_TITLE, sheet.width)) {
    sheet.text(line, { size: SIZE_TITLE, font: 'bold' })
    sheet.y -= SIZE_TITLE * 1.25
  }
  sheet.y -= 10

  const keyWidth = 64
  for (const { key, value } of doc.meta) {
    sheet.text(encodable(key.toUpperCase()), {
      size: SIZE_META,
      font: 'bold',
      color: QUIET,
    })
    const lines = wrap(encodable(value), fonts.body, SIZE_META, sheet.width - keyWidth)
    lines.forEach((line, i) => {
      sheet.text(line, {
        x: MARGIN + keyWidth,
        y: sheet.y - SIZE_META - i * SIZE_META * LEADING,
        size: SIZE_META,
        color: QUIET,
      })
    })
    sheet.y -= lines.length * SIZE_META * LEADING + 2
  }
  sheet.y -= 16

  // ---- the grid -----------------------------------------------------------
  // Three columns: where in the track, what was quoted, and the analysis.
  const whereW = sheet.width * WHERE_COL
  const exampleW = sheet.width * EXAMPLE_COL
  const analysisW = sheet.width * ANALYSIS_COL
  const whereX = MARGIN
  const exampleX = MARGIN + whereW
  const analysisX = exampleX + exampleW
  const exampleInner = exampleW - CELL_PAD * 2
  const analysisInner = analysisW - CELL_PAD * 2
  const whereInner = whereW - CELL_PAD * 2

  /** One row of shaded, boxed headings, redrawn on every page it spills onto. */
  const headerRow = (labels: string[], widths: number[], xs: number[]) => {
    const h = SIZE_HEAD * LEADING + CELL_PAD * 2
    const top = sheet.y - h
    labels.forEach((label, i) => {
      sheet.rect(xs[i], top, widths[i], h, HEADER_FILL, RULE)
      const text = encodable(label)
      const width = fonts.bold.widthOfTextAtSize(text, SIZE_HEAD)
      sheet.text(text, {
        // Centred while it fits; a heading wider than its column starts at the
        // padding instead of hanging off the left edge.
        x: xs[i] + Math.max(CELL_PAD, (widths[i] - width) / 2),
        y: top + CELL_PAD + 1,
        size: SIZE_HEAD,
        font: 'bold',
      })
    })
    sheet.y = top
  }

  const drawHeader = () =>
    headerRow(
      [WHERE_HEADING, EXAMPLE_HEADING, ANALYSIS_HEADING],
      [whereW, exampleW, analysisW],
      [whereX, exampleX, analysisX],
    )

  // ---- structure ----------------------------------------------------------
  // The frame the rest of the notes sit inside, so it goes first and on its
  // own. On a song-structure board this *is* the document.
  if (doc.sections.length) {
    const cols = [sheet.width * 0.28, sheet.width * 0.16, sheet.width * 0.56]
    const xs = [MARGIN, MARGIN + cols[0], MARGIN + cols[0] + cols[1]]
    sheet.text(encodable(SECTIONS_HEADING), { size: SIZE_GROUP, font: 'bold' })
    sheet.y -= SIZE_GROUP * LEADING + 6
    headerRow([...SECTION_COLS], cols, xs)
    for (const section of doc.sections) {
      const cells = [
        wrap(encodable(section.name), fonts.bold, SIZE_BODY, cols[0] - CELL_PAD * 2),
        wrap(encodable(section.span), fonts.body, SIZE_BODY, cols[1] - CELL_PAD * 2),
        wrap(encodable(section.text), fonts.body, SIZE_BODY, cols[2] - CELL_PAD * 2),
      ]
      const rowH =
        Math.max(...cells.map((c) => c.length)) * SIZE_BODY * LEADING + CELL_PAD * 2
      if (rowH > sheet.room) {
        sheet.break()
        headerRow([...SECTION_COLS], cols, xs)
      }
      const top = sheet.y - rowH
      cells.forEach((lines, i) => {
        sheet.rect(xs[i], top, cols[i], rowH, undefined, RULE)
        lines.forEach((line, n) => {
          sheet.text(line, {
            x: xs[i] + CELL_PAD,
            y: sheet.y - CELL_PAD - SIZE_BODY - n * SIZE_BODY * LEADING,
            size: SIZE_BODY,
            font: i === 0 ? 'bold' : 'body',
            color: i === 1 ? QUIET : INK,
          })
        })
      })
      sheet.y = top
    }
    sheet.y -= 6
  }

  for (const group of doc.groups) {
    const heading = encodable(`${GROUP_PREFIX} — ${group.label}`)
    const headingH = SIZE_GROUP * LEADING + 6
    const headerH = SIZE_HEAD * LEADING + CELL_PAD * 2

    // Every row is measured (and its picture embedded) before any of them is
    // drawn, so the table's first row can be taken into account when deciding
    // where the heading goes. Without that, a heading and its column headings
    // land at the foot of a page and the rows they belong to start on the next
    // one — an orphan the reader has to scroll past to find out it meant
    // nothing.
    const measured = []
    for (const row of group.rows) {
      const lines = await analysisLines(row, fonts, analysisInner, embed, pictures.images)
      const image = row.quote ? await embed(row.quote) : null
      const captionLines =
        image && row.quoteFrom
          ? wrap(encodable(row.quoteFrom), fonts.italic, SIZE_SMALL, exampleInner)
          : []
      const whereLines = row.where.flatMap((line, i) =>
        wrap(
          encodable(line),
          i === 0 ? fonts.bold : fonts.body,
          SIZE_BODY,
          whereInner,
        ).map((text) => ({ text, bold: i === 0 })),
      )
      let imageW = exampleInner
      let imageH = row.quote ? (exampleInner * row.quote.height) / row.quote.width : 0
      if (row.quote && imageH > IMAGE_MAX_H) {
        imageH = IMAGE_MAX_H
        imageW = (IMAGE_MAX_H * row.quote.width) / row.quote.height
      }
      const exampleH =
        CELL_PAD * 2 +
        imageH +
        (image && captionLines.length ? 5 : 0) +
        captionLines.length * SIZE_SMALL * LEADING
      const rowH = Math.max(
        heightOf(lines) + CELL_PAD * 2,
        exampleH,
        whereLines.length * SIZE_BODY * LEADING + CELL_PAD * 2,
        34,
      )
      measured.push({
        lines,
        image,
        captionLines,
        whereLines,
        imageW,
        imageH,
        rowH,
        color: row.color,
      })
    }
    if (measured.length === 0) continue

    const startTable = () => {
      sheet.text(heading, { size: SIZE_GROUP, font: 'bold' })
      sheet.y -= headingH
      drawHeader()
    }
    // The gap above the heading is part of what has to fit, not something to
    // subtract once the check has passed — taking it afterwards is exactly how
    // a heading lands on a page whose remaining room its first row then misses.
    const gap = sheet.y < PAGE_H - MARGIN ? 14 : 0
    if (sheet.room - gap < headingH + headerH + measured[0].rowH + 2) sheet.break()
    else sheet.y -= gap
    startTable()

    for (const m of measured) {
      // A row taller than a page can't be split, so it opens a page of its own
      // rather than being silently cut in half at the margin.
      if (m.rowH > sheet.room && sheet.room < PAGE_H - MARGIN * 2 - 24) {
        sheet.break()
        startTable()
      }

      const top = sheet.y - m.rowH
      sheet.rect(whereX, top, whereW, m.rowH, undefined, RULE)
      sheet.rect(exampleX, top, exampleW, m.rowH, undefined, RULE)
      sheet.rect(analysisX, top, analysisW, m.rowH, undefined, RULE)

      // Where column — the timecode in bold, the bar under it, and a rule in
      // the note's own hue, which is how a note is identified everywhere else
      // in the app. A rule rather than text, so the hue never has to clear AA.
      sheet.rect(
        whereX + CELL_PAD - 3,
        top + CELL_PAD,
        1.8,
        m.rowH - CELL_PAD * 2,
        ink(m.color, [0.72, 0.7, 0.64]),
      )
      m.whereLines.forEach((line, i) => {
        sheet.text(line.text, {
          x: whereX + CELL_PAD + 3,
          y: sheet.y - CELL_PAD - SIZE_BODY - i * SIZE_BODY * LEADING,
          size: SIZE_BODY,
          font: line.bold ? 'bold' : 'body',
          color: line.bold ? INK : QUIET,
        })
      })

      // Example column — top-aligned, like the guide's own tables.
      let ey = sheet.y - CELL_PAD
      if (m.image) {
        // Centred, since a height-capped picture no longer fills the column.
        sheet.image(
          m.image,
          exampleX + CELL_PAD + (exampleInner - m.imageW) / 2,
          ey - m.imageH,
          m.imageW,
          m.imageH,
        )
        ey -= m.imageH + 5
      }
      for (const line of m.captionLines) {
        const w = fonts.italic.widthOfTextAtSize(line, SIZE_SMALL)
        sheet.text(line, {
          x: exampleX + CELL_PAD + (exampleInner - w) / 2,
          y: ey - SIZE_SMALL,
          size: SIZE_SMALL,
          font: 'italic',
          color: QUIET,
        })
        ey -= SIZE_SMALL * LEADING
      }

      // Analysis column.
      let ay = sheet.y - CELL_PAD
      for (const line of m.lines) {
        ay -= line.gap
        drawLine(sheet, line, analysisX + CELL_PAD, ay, fonts)
        ay -= advance(line)
      }

      sheet.y = top
    }
  }

  return pdf.save()
}

/**
 * Export a project's notes as a PDF and open the file.
 *
 * The tab is opened **before** the document is built, and navigated once it
 * is: a score has to be fetched and rasterised for the picture quotes, and a
 * `window.open` on the far side of an `await` has lost the user gesture that
 * pop-up blockers look for. If the pop-up is blocked anyway the file is
 * downloaded instead, which needs no such permission — either way the press
 * produces a PDF rather than a page about one.
 *
 * That waiting tab carries a real progress bar, because the wait is real:
 * rasterising a long score at print resolution takes seconds per page, and a
 * bar that names the page it is on is the difference between "working" and
 * "stuck". `onProgress` reports the same thing back to the button that was
 * pressed, which is where the user's attention was a moment ago.
 */
export async function exportProjectPdf(
  project: Project,
  onProgress?: ProgressFn,
): Promise<void> {
  if (typeof window === 'undefined') return
  const tab = window.open('', '_blank')
  if (tab) {
    tab.document.write(WAITING_HTML)
    tab.document.close()
  }

  /** Push a step to both the waiting tab and the button that was pressed. */
  const report: ProgressFn = (value, label) => {
    onProgress?.(value, label)
    // The tab is same-origin (about:blank), so its DOM is reachable directly —
    // but it can be closed at any moment by the person watching it.
    try {
      if (!tab || tab.closed) return
      const bar = tab.document.getElementById('bar')
      const text = tab.document.getElementById('label')
      if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
      if (text) text.textContent = label
    } catch {
      /* the tab went away mid-export; the file still arrives */
    }
  }

  try {
    // Collecting the pictures is nearly all of the wall clock; laying the
    // document out is the short tail after it.
    const pictures = await collectPictures(project, (v, label) =>
      report(v * 0.85, label),
    )
    report(0.88, 'Laying out the document')
    const bytes = await buildStudyPdf(
      buildStudyDoc(project, pictures.quotes),
      docName(project),
      pictures,
    )
    report(1, 'Opening the PDF')
    openFile(bytes, 'application/pdf', `${docName(project)}.pdf`, tab)
  } catch (err) {
    console.error('PDF export failed:', err)
    // Said in the tab the user is looking at, rather than in an alert behind
    // it — and the tab is left open so the message can actually be read.
    try {
      if (tab && !tab.closed) {
        const text = tab.document.getElementById('label')
        const bar = tab.document.getElementById('bar')
        if (bar) bar.style.width = '100%'
        if (text) text.textContent = "That export couldn't be built. Close this and try again."
      } else {
        alert("That export couldn't be built — please try again.")
      }
    } catch {
      alert("That export couldn't be built — please try again.")
    }
  }
}

/**
 * Hand a generated file to the browser: into the tab held open for it if there
 * is one (so a PDF opens in the viewer), and as a download otherwise — which
 * is also the right answer for a .docx, which no browser can display.
 */
export function openFile(
  bytes: Uint8Array,
  type: string,
  filename: string,
  tab: Window | null,
): void {
  // A fresh copy: a generator may hand back a view onto a larger buffer, and
  // Blob would otherwise take the whole thing.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type })
  const url = URL.createObjectURL(blob)
  if (tab && !tab.closed) {
    tab.location.replace(url)
  } else {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

/**
 * The page the new tab shows while the document is built — paper-coloured, so
 * it reads as the document arriving rather than as an error, with a bar and a
 * line saying which page of the score is being drawn.
 */
const WAITING_HTML = `<!doctype html><html><head><meta charset="utf-8" /><title>Preparing\u2026</title></head><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#e9e2d2;color:#3a352c;font:13px/1.5 'Helvetica Neue',Arial,system-ui,sans-serif"><div style="width:min(320px,70vw);text-align:center"><div style="font:600 10px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.22em;text-transform:uppercase;color:#9a5d08">Sound Annotator</div><div style="height:6px;margin:18px 0 10px;border-radius:99px;background:#d6cdb9;overflow:hidden"><div id="bar" style="height:100%;width:2%;border-radius:99px;background:#e08a0c;transition:width .25s ease"></div></div><div id="label" style="color:#6e6555">Preparing the PDF\u2026</div></div></body></html>`
