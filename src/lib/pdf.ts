// The pdf.js glue — the only file that knows pdf.js exists.
//
// pdf.js is a heavy dependency (the library plus a worker), and most tracks
// have no score, so the library is imported lazily on first use: a track
// without a score never pays for it. The worker is a separate emitted asset
// referenced by URL, which is Vite's supported shape for it.
//
// Why we render to a canvas at all, rather than dropping the PDF in an
// <iframe> and letting the browser's viewer draw it: an iframe's viewer
// exposes no page control, so nothing outside it can turn the page — which is
// the whole feature. Owning the canvas also lets us fit a page to the frame
// and, later, flip it on the clock.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ScoreFit } from '../types'

type PdfJs = typeof import('pdfjs-dist')

let libPromise: Promise<PdfJs> | null = null

/** Load pdf.js once per session and point it at its worker. */
function pdfjs(): Promise<PdfJs> {
  libPromise ??= import('pdfjs-dist').then((mod) => {
    mod.GlobalWorkerOptions.workerSrc = workerUrl
    return mod
  })
  return libPromise
}

/** Size, in CSS pixels, a page was drawn at. */
export interface PageSize {
  width: number
  height: number
}

export interface LoadedPdf {
  pageCount: number
  /**
   * Draw `page` into `canvas`, fitted to `box`. Resolves with the size the
   * page was drawn at in CSS pixels — height-fit letterboxes the page inside
   * the box, width-fit fills the width and may run taller than it (the caller
   * scrolls). Cancels any render still in flight on the same document, so a
   * fast page-flip or a resize can't leave two renders racing onto one canvas.
   */
  render(
    page: number,
    canvas: HTMLCanvasElement,
    box: PageSize,
    fit: ScoreFit,
  ): Promise<PageSize>
  destroy(): void
}

/** Bound the backing store: 2× is already crisp, and a score page is big. */
const MAX_DEVICE_SCALE = 2

/**
 * Open a PDF from bytes. Deliberately takes bytes rather than a URL: it keeps
 * the whole file to one request (pdf.js would otherwise range-fetch it, and
 * every range is another hit on our Drive proxy), and it lets the caller map
 * a transport failure to its own words before pdf.js sees it.
 *
 * Throws with a user-facing message when the bytes aren't a readable PDF.
 */
export async function openPdf(bytes: ArrayBuffer): Promise<LoadedPdf> {
  const lib = await pdfjs()
  // The loading task, not the document, owns the worker — it's what `destroy`
  // has to reach to tear one down.
  const loading = lib.getDocument({ data: bytes })
  // Typed explicitly: `draw` below closes over it before the assignment,
  // which would otherwise leave it inferred as `any`.
  let doc: Awaited<typeof loading.promise>
  try {
    doc = await loading.promise
  } catch (e) {
    throw new Error(
      e instanceof Error && /password/i.test(e.message)
        ? 'That PDF is password-protected.'
        : "That file couldn't be read as a PDF.",
      { cause: e },
    )
  }

  // pdf.js refuses two renders onto one canvas ("Cannot use the same canvas
  // during multiple render() operations"), and cancelling isn't instant — the
  // canvas is only free once the cancelled task's promise has settled. Fast
  // page flips and resize storms both produce exactly that overlap, so renders
  // are serialized through a chain: cancel what's drawing, wait for it to let
  // go, then draw. A request superseded while it waited returns its size
  // without touching the canvas — nothing is looking at it any more.
  let chain: Promise<unknown> = Promise.resolve()
  let active: { cancel(): void } | null = null
  let generation = 0

  async function draw(
    gen: number,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    box: PageSize,
    fit: ScoreFit,
  ): Promise<PageSize> {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages))
    const base = page.getViewport({ scale: 1 })
    const scale =
      fit === 'width'
        ? box.width / base.width
        : Math.min(box.height / base.height, box.width / base.width)
    const viewport = page.getViewport({ scale: Math.max(scale, 0.01) })
    const size = { width: viewport.width, height: viewport.height }
    if (gen !== generation) return size

    const device = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_SCALE)
    canvas.width = Math.max(1, Math.round(viewport.width * device))
    canvas.height = Math.max(1, Math.round(viewport.height * device))

    const task = page.render({
      canvas,
      viewport,
      // The device-pixel upscale, handed to pdf.js rather than applied to the
      // context ourselves — it owns the context for the length of the render.
      ...(device === 1 ? {} : { transform: [device, 0, 0, device, 0, 0] }),
    })
    active = task
    try {
      await task.promise
    } catch (e) {
      // A cancelled render is the ordinary outcome of a flip or a resize: the
      // next one is already queued behind it, not an error to report.
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) throw e
    } finally {
      if (active === task) active = null
    }
    return size
  }

  return {
    pageCount: doc.numPages,
    render(pageNumber, canvas, box, fit) {
      const gen = ++generation
      active?.cancel()
      const run = chain.then(() => draw(gen, pageNumber, canvas, box, fit))
      // The chain must never reject, or one failed page would wedge every
      // later render behind it.
      chain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
    destroy() {
      generation++
      active?.cancel()
      void loading.destroy()
    },
  }
}
