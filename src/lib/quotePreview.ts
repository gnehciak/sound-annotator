// Showing a note's **score quote** on screen — as the note's cover in the list,
// and as the thumbnail in the inspector.
//
// A quote is a rectangle, never an image (see NoteQuote in ../types), so the
// pixels have to be found again every time anyone wants to look at one. The
// exports already do that (lib/quoteImages.ts) at print resolution, in one
// pass, behind a progress bar. This is the other consumer: many small crops,
// asked for one note at a time, while the reader scrolls a list — so the work
// is shared rather than repeated.
//
// Three things make that cheap enough to do on a list row:
//
//  • **one document per score**, opened here and kept while anything is
//    looking, then released when nothing has asked for a while. The score
//    layer keeps its own copy, but it is only mounted while the score view is
//    on and the list draws its covers whether or not it is.
//  • **one raster per page**, cut up for every quote on it. A page carrying
//    six quotes is drawn once.
//  • **the crops are cached** by the rectangle they came from, so re-rendering
//    the list — which happens on every tick of the playhead — costs nothing.
//
// Rasters are drawn one at a time. Twenty notes mounting at once would
// otherwise start twenty pdf.js renders in the same instant, and the page the
// reader is actually looking at would queue behind the nineteen it isn't.
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { openPdf, type LoadedPdf } from './pdf'
import { quotePageOf } from './overlays'
import { cropImage } from './quoteImages'
import type { NoteQuote } from '../types'

/** Width a page is rasterised at, in CSS pixels. */
const PAGE_PX = 760

/** Widest a crop is kept at — a list row is nowhere near this. */
const CROP_MAX_PX = 420

/** How many page rasters to keep. Each is a canvas, so this is real memory. */
const MAX_PAGES = 6

/** How many crops to keep. A crop is a JPEG data URL, tens of kilobytes. */
const MAX_CROPS = 48

/** Bounds on the render scale, so a degenerate page size can't run away. */
const MIN_SCALE = 0.2
const MAX_SCALE = 4

/**
 * How long the document is kept open after the last request. Long enough to
 * cover switching notes and scrolling the list; short enough that a track left
 * open all lesson isn't holding a parsed PDF and its worker.
 */
const IDLE_RELEASE_MS = 60_000

/**
 * The score the quotes on screen are cut from, as the URL its bytes come from
 * (`scoreBytesUrl`). Null where the track has no score — or where nobody has
 * provided one, which is how a presentation opts out of previews entirely.
 *
 * A context rather than a prop threaded down: every note in the list and the
 * one open in the inspector all quote the *same* score, and it is the host —
 * App, the share viewer — that knows which.
 */
const QuoteScoreContext = createContext<string | null>(null)

export function QuoteScoreProvider({
  url,
  children,
}: {
  url: string | null
  children: ReactNode
}) {
  return createElement(QuoteScoreContext.Provider, { value: url }, children)
}

/** A crop ready to draw: a data URL and the shape it is. */
export interface QuotePreview {
  src: string
  width: number
  height: number
}

/**
 * The picture behind a note's quote, or null while it is being drawn (or if it
 * can't be). Null is the honest answer for "no score", "the score wouldn't
 * load" and "not yet" alike: every caller draws nothing in all three, because
 * a placeholder for a picture that may never arrive is worse than no picture.
 *
 * Every caller of this shares one open document, one raster per page and one
 * cache of crops, so a list of twenty quoted notes costs one fetch and one
 * render per page rather than one of each per note.
 */
export function useQuotePreview(quote: NoteQuote | undefined): QuotePreview | null {
  const url = useContext(QuoteScoreContext)
  const key = quote && url ? cropKey(url, quote) : null
  // The crop *and* what it is of, together: a crop that resolves after the row
  // moved on to another note must not be drawn on it. Reset during render as
  // the key changes (React's documented shape for state derived from a prop)
  // rather than in an effect, which would paint one frame of the previous
  // note's music on this one's row.
  const [shown, setShown] = useState<{ key: string | null; crop: QuotePreview | null }>(
    () => ({ key, crop: (key && crops.get(key)) || null }),
  )
  if (shown.key !== key) setShown({ key, crop: (key && crops.get(key)) || null })

  useEffect(() => {
    if (!key || !quote || !url || crops.get(key)) return
    let alive = true
    void quoteCrop(url, quote).then((crop) => {
      if (alive) setShown({ key, crop })
    })
    return () => {
      alive = false
    }
  }, [key, quote, url])

  return shown.key === key ? shown.crop : null
}

const cropKey = (url: string, q: NoteQuote) =>
  `${url}|${quotePageOf(q)}|${r(q.x)},${r(q.y)},${r(q.w)},${r(q.h)}`

/** Fractions to the nearest thousandth — finer than a crop can show. */
const r = (n: number) => Math.round(n * 1000)

// ---- the shared document, its rasters and its crops -----------------------

const crops = new Map<string, QuotePreview>()
const pages = new Map<string, Promise<HTMLCanvasElement | null>>()
let doc: { url: string; open: Promise<LoadedPdf | null> } | null = null
let idle: ReturnType<typeof setTimeout> | undefined
/** Renders run one at a time; this is the tail of the queue. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Cut one quote out of its page, keeping the result.
 *
 * A crop that couldn't be made is deliberately *not* kept: the reasons are all
 * transient (the score hadn't loaded, the fetch failed) and a cached "no" would
 * outlive them for the whole session. Nothing stampedes as a result — the
 * document and the page raster below cache their own failures, so a retry is a
 * map lookup rather than another trip to the network.
 */
async function quoteCrop(url: string, quote: NoteQuote): Promise<QuotePreview | null> {
  const canvas = await pageRaster(url, quotePageOf(quote))
  // A raster evicted between resolving and being read has had its backing
  // store freed; cropping that would cache a blank picture for good.
  const crop =
    canvas && canvas.width > 0
      ? cropImage(canvas, canvas.width, canvas.height, quote, CROP_MAX_PX)
      : null
  if (crop) remember(crops, cropKey(url, quote), crop, MAX_CROPS)
  return crop
}

/** The page, drawn once and kept for every other quote aimed at it. */
function pageRaster(url: string, page: number): Promise<HTMLCanvasElement | null> {
  const key = `${url}|${page}`
  const held = pages.get(key)
  if (held) return held
  const raster = queued(async () => {
    const pdf = await openScore(url)
    if (!pdf) return null
    const n = Math.min(Math.max(1, page), pdf.pageCount)
    const size = await pdf.pageSize(n)
    if (size.width < 1) return null
    const canvas = document.createElement('canvas')
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, PAGE_PX / size.width))
    // Offscreen, like the exports: this can be asked for while the tab is in
    // the background (a list left open behind an export's tab), and pdf.js's
    // on-screen path waits on an animation frame that never comes there.
    await pdf.render(n, canvas, scale, { offscreen: true })
    return canvas
  }).catch((err) => {
    console.warn('Quote preview: the score page could not be drawn —', err)
    return null
  })
  remember(pages, key, raster, MAX_PAGES)
  return raster
}

/** The score's document, opened once and released when nothing wants it. */
function openScore(url: string): Promise<LoadedPdf | null> {
  if (doc && doc.url !== url) release()
  doc ??= {
    url,
    open: fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`the score could not be fetched (${res.status})`)
        return res.arrayBuffer()
      })
      .then(openPdf)
      .catch((err) => {
        console.warn('Quote preview: the score could not be read —', err)
        return null
      }),
  }
  clearTimeout(idle)
  idle = setTimeout(release, IDLE_RELEASE_MS)
  return doc.open
}

/** Let the document and its rasters go; the crops already drawn are kept. */
function release() {
  clearTimeout(idle)
  idle = undefined
  const held = doc
  doc = null
  for (const raster of pages.values()) void raster.then(discard)
  pages.clear()
  void held?.open.then((pdf) => pdf?.destroy())
}

/** Put `job` at the end of the render queue and hand back its result. */
function queued<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job)
  // The queue must not inherit a rejection, or every later render is skipped.
  queue = run.catch(() => undefined)
  return run
}

/** Insert, then drop the oldest entries past `max` — a plain LRU by age. */
function remember<T>(map: Map<string, T>, key: string, value: T, max: number) {
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) {
    if (map.size <= max) break
    const gone = map.get(old)
    if (gone instanceof Promise) void gone.then(discard)
    map.delete(old)
  }
}

/** Free a raster's backing store rather than waiting for the collector. */
function discard(canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}
