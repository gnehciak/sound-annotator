// The score's marks, drawn onto a canvas — so a picture cut out of a page
// carries what the teacher drew on that page.
//
// A quote is cropped from a raster pdf.js makes of the PDF, and the marks are
// not in the PDF: they are SVG the app lays over the page (components/
// ScoreMarks). So a note quoting the bar someone highlighted used to print the
// bar *without* the highlight — in the handout, in the answer sheet and in the
// thumbnail on its own row. This draws the same marks into the crop, in the
// same geometry (lib/score's `strokeOf`, `arrowWings` and the text metrics),
// so the two can't drift apart.
import type { ScoreMark } from '../types'
import {
  HIGHLIGHT_OPACITY,
  TEXT_ASCENT,
  TEXT_FONT,
  TEXT_LEADING,
  arrowWings,
  strokeOf,
  textSizeOf,
} from './score'
import { hueText } from './noteColors'

/**
 * Where the page sits on the canvas: a page `pageW` × `pageH` in its own
 * pixels, offset by (`ox`, `oy`) of those pixels and then scaled — which is
 * exactly what a crop is (the offset is the crop's corner, the scale its
 * shrink), and, with a zero offset and a scale of 1, a whole page.
 */
export interface PageTransform {
  pageW: number
  pageH: number
  ox: number
  oy: number
  scale: number
}

/** Draw `marks` — already filtered to one page — in list order, which is z-order. */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: ScoreMark[],
  t: PageTransform,
): void {
  if (marks.length === 0) return
  const X = (fx: number) => (fx * t.pageW - t.ox) * t.scale
  const Y = (fy: number) => (fy * t.pageH - t.oy) * t.scale
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const m of marks) {
    const stroke = strokeOf(m.weight, t.pageW) * t.scale
    const x = X(m.x)
    const y = Y(m.y)
    const w = m.w * t.pageW * t.scale
    const h = m.h * t.pageH * t.scale
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = m.color
    ctx.lineWidth = stroke
    switch (m.kind) {
      case 'highlight':
        // Multiply, as on screen: the staves stay legible through the wash,
        // which is the difference between a highlighter and paint.
        ctx.globalCompositeOperation = 'multiply'
        ctx.globalAlpha = HIGHLIGHT_OPACITY
        ctx.fillStyle = m.color
        ctx.fillRect(Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h))
        break
      case 'box':
        ctx.strokeRect(Math.min(x, x + w), Math.min(y, y + h), Math.abs(w), Math.abs(h))
        break
      case 'ellipse':
        ctx.beginPath()
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'arrow': {
        const wings = arrowWings(x, y, w, h, stroke)
        if (!wings) break
        const [[ax, ay], [bx, by]] = wings
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x + w, y + h)
        ctx.moveTo(ax, ay)
        ctx.lineTo(x + w, y + h)
        ctx.lineTo(bx, by)
        ctx.stroke()
        break
      }
      case 'ink': {
        const p = m.points ?? []
        if (p.length < 4) break
        ctx.beginPath()
        ctx.moveTo(X(p[0]), Y(p[1]))
        for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(X(p[i]), Y(p[i + 1]))
        ctx.stroke()
        break
      }
      case 'text': {
        const size = textSizeOf(m.weight) * t.pageW * t.scale
        ctx.fillStyle = hueText(m.color, 'light')
        ctx.font = `${size}px ${TEXT_FONT}`
        ctx.textBaseline = 'alphabetic'
        ;(m.text ?? '').split('\n').forEach((line, i) => {
          ctx.fillText(line, x, y + size * (TEXT_ASCENT + i * TEXT_LEADING))
        })
        break
      }
    }
  }
  ctx.restore()
}

/**
 * A short fingerprint of what is drawn on a page, for cache keys: a crop made
 * before a mark moved must not be served after it.
 */
export function marksSignature(marks: ScoreMark[]): string {
  if (marks.length === 0) return ''
  const s = JSON.stringify(marks)
  let h = 5381
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return `${marks.length}:${(h >>> 0).toString(36)}`
}
