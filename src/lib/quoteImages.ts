// Turning a note's **score quote** (a rectangle — see NoteQuote in ../types)
// into a picture the exported documents can carry.
//
// The rectangle is all that's stored, so the pixels have to be found again at
// export time. That is the whole point of storing a rectangle: a quote costs
// no upload, adds nothing for the blob sweeps to collect or the project copier
// to re-host, and a Drive score that gains a new engraving quotes the new
// engraving on the next export. The cost is this module.
//
// The score's bytes we already fetch and rasterise (lib/pdf.ts). Each
// referenced page is drawn once, at a scale chosen from the narrowest crop on
// it, and every quote on that page is cut out of that raster.
//
// Everything comes back as a **JPEG**, because the two things that consume it
// are a PDF and a .docx, and both want bytes rather than a styled window: the
// crop is done here, on a canvas, once. The notes' own inline images come
// through the same pass — they may be PNGs or WebPs, which neither renderer
// takes — and reading those is cross-origin, which is fine (the Blob store
// answers `access-control-allow-origin: *`) as long as the request asks for
// CORS and a tainted canvas is caught rather than thrown.
//
// The same crops are wanted on screen, much smaller and one note at a time;
// lib/quotePreview.ts does that, over `cropImage` below.
import type { Annotation, Project } from '../types'
import { openPdf } from './pdf'
import { quoteOf, quotePageOf } from './overlays'
import { scoreBytesUrl } from './score'
// A type-only cycle back the other way (studyDoc takes QuoteImage), which is
// erased at build; this direction is the real dependency.
import { noteImageUrls } from './studyDoc'

/**
 * How an export says where it has got to: a fraction of the way through, and
 * what it is doing in words.
 *
 * Both halves matter. Collecting the pictures means fetching a score over the
 * network and rasterising pages of it at print resolution, which on a long
 * score is genuinely slow — long enough that a spinner alone reads as a hang.
 * A bar answers "how much longer"; the label answers "is it stuck", which is
 * the question a bar on its own leaves open.
 */
export type ProgressFn = (value: number, label: string) => void

/** A quote ready to place in a document: JPEG bytes and the size they are. */
export interface QuoteImage {
  /** `data:image/jpeg;base64,…` — what both renderers embed. */
  src: string
  width: number
  height: number
}

/**
 * Width to aim for when rasterising a crop, in CSS pixels before the device
 * multiplier lib/pdf.ts applies on top. Enough to print an engraved system
 * cleanly across a column; `QUOTE_MAX_PX` is where the result is scaled back
 * down, so a small rectangle on a large page can't become a twenty-megapixel
 * data URL riding inside the file.
 */
const QUOTE_TARGET_PX = 1100
const QUOTE_MAX_PX = 1700

/**
 * How big a note's own inline picture is carried at.
 *
 * It was already downscaled to 1600px on upload, so this is a second bound for
 * the document's sake: a note with a dozen screen grabs would otherwise put a
 * dozen full-size photographs inside the file, base64'd.
 */
const NOTE_IMAGE_MAX_PX = 1200

/** Bounds on the render scale, so a degenerate page size can't run away. */
const MIN_SCALE = 0.5
const MAX_SCALE = 8

/**
 * How long the whole collection may take before the documents go out without
 * their pictures.
 *
 * Not a nicety: a score is fetched over the network, and a Drive score goes
 * through our own proxy, which can be slow or — if the file stopped being
 * link-shared — never usefully answer at all. An export that waits forever on
 * that is indistinguishable from a broken one, and the notes are the part
 * people actually asked for.
 */
const COLLECT_TIMEOUT_MS = 20_000

/** Everything an exported document has to draw, fetched and cropped. */
export interface DocPictures {
  /** Score quotes, by the id of the note that aimed them. */
  quotes: Map<string, QuoteImage>
  /** The notes' own inline images, by the URL the prose references. */
  images: Map<string, QuoteImage>
}

/**
 * Every picture a document needs: the quotes each note aimed, and the images
 * its prose carries. Anything that can't be resolved is simply absent — an
 * export that loses a picture is worth far more than one that fails, or one
 * that never arrives.
 *
 * One pass for both, so there is one deadline and one progress arc rather than
 * two rounds of waiting stacked end to end.
 */
export async function collectPictures(
  project: Project,
  onProgress?: ProgressFn,
): Promise<DocPictures> {
  const out = new Map<string, QuoteImage>()
  const images = new Map<string, QuoteImage>()
  const quoted = project.annotations.filter((a) => quoteOf(a))
  const urls = noteImageUrls(project)
  if (quoted.length === 0 && urls.length === 0) return { quotes: out, images }

  // Reported over 0→1 of *this* phase; the exporters scale it into their own,
  // since laying the document out is the short tail after this.
  const report: ProgressFn = (value, label) => onProgress?.(value, label)
  const work = Promise.all([
    addScoreQuotes(project, quoted, out, report),
    addNoteImages(urls, images),
  ])
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn('Score quotes: gave up waiting; exporting without them.')
      resolve()
    }, COLLECT_TIMEOUT_MS)
  })
  // Whatever landed before the deadline is kept — `out` is filled as each
  // picture resolves, not at the end.
  await Promise.race([work, deadline])
  clearTimeout(timer)
  return { quotes: out, images }
}

/** The notes' own inline pictures, re-encoded so a document can embed them. */
async function addNoteImages(
  urls: string[],
  out: Map<string, QuoteImage>,
): Promise<void> {
  await Promise.all(
    urls.map(async (url) => {
      const img = await loadImage(url)
      if (!img) return
      // The whole picture, not a crop — but through the same canvas, because a
      // note image may be a PNG or a WebP and neither renderer takes those.
      const picture = cropImage(
        img,
        img.naturalWidth,
        img.naturalHeight,
        { x: 0, y: 0, w: 1, h: 1 },
        NOTE_IMAGE_MAX_PX,
      )
      if (picture) out.set(url, picture)
    }),
  )
}

/** Quotes aimed at the score: one raster per page, cut up per quote. */
async function addScoreQuotes(
  project: Project,
  notes: Annotation[],
  out: Map<string, QuoteImage>,
  report: ProgressFn,
): Promise<void> {
  const score = project.settings?.score
  const url = notes.length > 0 && score ? scoreBytesUrl(score) : null
  if (!url) {
    report(1, 'Cropping the pictures')
    return
  }

  let doc: Awaited<ReturnType<typeof openPdf>> | null = null
  try {
    report(0.04, 'Fetching the score')
    const res = await fetch(url)
    if (!res.ok) throw new Error(`score fetch failed: ${res.status}`)
    report(0.12, 'Reading the score')
    doc = await openPdf(await res.arrayBuffer())

    // Grouped by page so a page carrying three quotes is drawn once. The scale
    // is the smallest that satisfies every crop on it — the narrowest
    // rectangle is the one that needs the most magnification.
    const byPage = new Map<number, Annotation[]>()
    for (const note of notes) {
      const page = Math.min(quotePageOf(quoteOf(note)!), doc.pageCount)
      const list = byPage.get(page)
      if (list) list.push(note)
      else byPage.set(page, [note])
    }

    const canvas = document.createElement('canvas')
    let drawn = 0
    for (const [page, group] of byPage) {
      report(
        0.15 + (0.85 * drawn) / byPage.size,
        byPage.size > 1
          ? `Drawing page ${page} (${drawn + 1} of ${byPage.size})`
          : `Drawing page ${page}`,
      )
      drawn += 1
      const intrinsic = await doc.pageSize(page)
      if (intrinsic.width < 1) continue
      const narrowest = Math.min(...group.map((a) => quoteOf(a)!.w))
      const scale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, QUOTE_TARGET_PX / (narrowest * intrinsic.width)),
      )
      // Offscreen: this runs while the app's own tab may be behind the one
      // opened for the document, and pdf.js's on-screen path waits for an
      // animation frame a hidden tab never fires. See RenderOptions.offscreen.
      await doc.render(page, canvas, scale, { offscreen: true })
      for (const note of group) {
        const crop = cropImage(canvas, canvas.width, canvas.height, quoteOf(note)!)
        if (crop) out.set(note.id, crop)
      }
    }
  } catch (err) {
    // One unreadable score costs the pictures, never the document.
    console.error('Score quotes: the score could not be read —', err)
  } finally {
    doc?.destroy()
    report(1, 'Cropping the pictures')
  }
}

/**
 * Cut a rectangle out of a drawable, as its own JPEG. Null if it can't be —
 * a canvas tainted by an image whose host refused CORS after all.
 *
 * Shared with lib/quotePreview, which wants the same crop at a fraction of the
 * size for the screen: what a quote *is* has one definition, and the caller
 * only picks how big.
 */
export function cropImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  q: { x: number; y: number; w: number; h: number },
  maxPx = QUOTE_MAX_PX,
): QuoteImage | null {
  const sx = Math.round(q.x * sourceWidth)
  const sy = Math.round(q.y * sourceHeight)
  const sw = Math.max(1, Math.round(q.w * sourceWidth))
  const sh = Math.max(1, Math.round(q.h * sourceHeight))
  const shrink = Math.min(1, maxPx / sw)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw * shrink))
  out.height = Math.max(1, Math.round(sh * shrink))
  const ctx = out.getContext('2d')
  if (!ctx) return null
  // A PDF page is transparent where nothing is drawn, and JPEG has no alpha —
  // without this the staves would come out on black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height)
  try {
    return { src: out.toDataURL('image/jpeg', 0.88), width: out.width, height: out.height }
  } catch {
    // A tainted canvas — the image's host refused CORS after all. Skip it.
    return null
  }
}

/** Load an image for reading, asking for CORS. Null if it can't be had. */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () =>
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** The JPEG bytes behind a quote's data URL, for a renderer that embeds them. */
export function quoteBytes(quote: QuoteImage): Uint8Array {
  const base64 = quote.src.slice(quote.src.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}
