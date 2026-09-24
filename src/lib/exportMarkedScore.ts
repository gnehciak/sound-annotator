// The score as a file, with what was drawn on it burned in — the copy a
// teacher hands out, or a reader keeps.
//
// Drawn *onto the original PDF* with pdf-lib rather than re-rasterised: the
// engraving stays vector, sharp at any zoom and as small as it was, and only
// the marks are added. Every mark is stored as fractions of the page *as
// pdf.js draws it* — the crop box, turned by the page's /Rotate — so the one
// piece of arithmetic here is mapping those fractions back into the page's own
// user space, turn and all (`toUser`). Every shape is then drawn as points
// through that map, which is what lets a rotated page need no special case
// beyond it.
import {
  BlendMode,
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { ProjectScore, ScoreMark } from '../types'
import {
  HIGHLIGHT_OPACITY,
  TEXT_ASCENT,
  TEXT_LEADING,
  arrowWings,
  scoreBytesUrl,
  strokeOf,
  textSizeOf,
} from './score'
import { hueText } from './noteColors'
import { encodable, openFile } from './exportPdf'

/**
 * Download `score` with `marks` drawn on it. Throws when the score can't be
 * fetched or read — the caller says so; a download that silently never comes
 * reads as a button that does nothing.
 */
export async function downloadMarkedScore(
  score: ProjectScore,
  marks: ScoreMark[],
  name: string,
): Promise<void> {
  const url = scoreBytesUrl(score)
  if (!url) throw new Error('This score has nothing to download.')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`The score could not be fetched (${res.status}).`)
  const bytes = await markScore(new Uint8Array(await res.arrayBuffer()), marks)
  openFile(bytes, 'application/pdf', `${fileSafe(name)} — marked.pdf`, null)
}

/** The PDF's bytes with `marks` drawn on their pages. Exported for testing. */
export async function markScore(pdfBytes: Uint8Array, marks: ScoreMark[]): Promise<Uint8Array> {
  // A score scanned by a school copier is sometimes "encrypted" with an empty
  // owner password; pdf-lib refuses those unless told the encryption is ours
  // to ignore, which for drawing on the page it is.
  const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  for (const m of marks) {
    const page = pages[m.page - 1]
    // A mark on a page the file no longer has — the score was replaced by a
    // shorter one — has nowhere honest to go.
    if (page) drawMark(page, m, font)
  }
  return pdf.save()
}

/** The page as pdf.js draws it: its size on screen, and the map back into user space. */
function frameOf(page: PDFPage) {
  const box = page.getCropBox()
  const turn = ((page.getRotation().angle % 360) + 360) % 360
  const sideways = turn === 90 || turn === 270
  const width = sideways ? box.height : box.width
  const height = sideways ? box.width : box.height
  /** A point given as fractions of the drawn page, in the page's user space. */
  const toUser = (fx: number, fy: number): [number, number] => {
    switch (turn) {
      case 90:
        return [box.x + fy * box.width, box.y + fx * box.height]
      case 180:
        return [box.x + (1 - fx) * box.width, box.y + fy * box.height]
      case 270:
        return [box.x + (1 - fy) * box.width, box.y + (1 - fx) * box.height]
      default:
        return [box.x + fx * box.width, box.y + (1 - fy) * box.height]
    }
  }
  return { width, height, turn, toUser }
}

function drawMark(page: PDFPage, m: ScoreMark, font: PDFFont): void {
  const { width, height, turn, toUser } = frameOf(page)
  const colour = hex(m.color)
  // The same thickness as on screen: `strokeOf` scales off the page's width,
  // and here the width is in points. A finer floor, since print resolves it.
  const stroke = strokeOf(m.weight, width, 0.6)
  // Points as page fractions → an SVG path in user space. pdf-lib reads an
  // SVG path with y pointing down from the origin it's given, so the user-space
  // y is negated and the origin left at (0, 0).
  const path = (pts: [number, number][], close = false) =>
    pts
      .map(([fx, fy], i) => {
        const [ux, uy] = toUser(fx, fy)
        return `${i ? 'L' : 'M'}${ux.toFixed(2)} ${(-uy).toFixed(2)}`
      })
      .join(' ') + (close ? ' Z' : '')
  const rect = (): [number, number][] => {
    const x0 = Math.min(m.x, m.x + m.w)
    const x1 = Math.max(m.x, m.x + m.w)
    const y0 = Math.min(m.y, m.y + m.h)
    const y1 = Math.max(m.y, m.y + m.h)
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
  }
  const outline = { x: 0, y: 0, borderColor: colour, borderWidth: stroke }

  switch (m.kind) {
    case 'highlight':
      page.drawSvgPath(path(rect(), true), {
        x: 0,
        y: 0,
        color: colour,
        opacity: HIGHLIGHT_OPACITY,
        blendMode: BlendMode.Multiply,
      })
      return
    case 'box':
      page.drawSvgPath(path(rect(), true), outline)
      return
    case 'ellipse': {
      // As a polygon fine enough to read as a curve: pdf-lib's own ellipse is
      // axis-aligned in user space, which a turned page is not.
      const cx = m.x + m.w / 2
      const cy = m.y + m.h / 2
      const pts: [number, number][] = []
      for (let i = 0; i < 64; i += 1) {
        const a = (i / 64) * Math.PI * 2
        pts.push([cx + (Math.cos(a) * Math.abs(m.w)) / 2, cy + (Math.sin(a) * Math.abs(m.h)) / 2])
      }
      page.drawSvgPath(path(pts, true), outline)
      return
    }
    case 'arrow': {
      // The wings are worked out in the drawn page's own points, where the
      // angle is true, then turned back into fractions to be mapped.
      const wings = arrowWings(m.x * width, m.y * height, m.w * width, m.h * height, stroke)
      const head: [number, number] = [m.x + m.w, m.y + m.h]
      page.drawSvgPath(path([[m.x, m.y], head]), outline)
      if (wings) {
        const [[ax, ay], [bx, by]] = wings
        page.drawSvgPath(path([[ax / width, ay / height], head, [bx / width, by / height]]), outline)
      }
      return
    }
    case 'ink': {
      const p = m.points ?? []
      const pts: [number, number][] = []
      for (let i = 0; i + 1 < p.length; i += 2) pts.push([p[i], p[i + 1]])
      if (pts.length > 1) page.drawSvgPath(path(pts), outline)
      return
    }
    case 'text': {
      const size = textSizeOf(m.weight) * width
      const ink = hex(hueText(m.color, 'light'))
      ;(m.text ?? '').split('\n').forEach((line, i) => {
        const words = encodable(line)
        if (!words) return
        // The baseline, as a fraction of the drawn page — the same stated
        // ascent the screen and the crops use, so the words sit where they
        // were typed rather than half a line off.
        const [ux, uy] = toUser(m.x, m.y + (size * (TEXT_ASCENT + i * TEXT_LEADING)) / height)
        page.drawText(words, {
          x: ux,
          y: uy,
          size,
          font,
          color: ink,
          // Along the drawn page's own x axis, which a turned page has turned.
          rotate: degrees(turn),
        })
      })
      return
    }
  }
}

/**
 * A mark's colour as pdf-lib wants it. Reads both shapes this app hands over:
 * the palette's `#rrggbb`, and the `rgb(r g b)` that `hueText` returns — a
 * text mark's ink went black here once, because only the first was read.
 */
function hex(color: string) {
  const c = color.trim()
  const h = /^#?([0-9a-f]{6})$/i.exec(c)
  if (h) {
    const n = parseInt(h[1], 16)
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
  }
  const f = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c)
  if (f) return rgb(Number(f[1]) / 255, Number(f[2]) / 255, Number(f[3]) / 255)
  return rgb(0, 0, 0)
}

const fileSafe = (s: string) => (s.trim() || 'Score').replace(/[\\/:*?"<>|]/g, '-')
