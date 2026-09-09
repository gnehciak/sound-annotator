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
   * The page's intrinsic size in CSS pixels at scale 1 — what the reader needs
   * to lay a page out *before* deciding to draw it. A continuously scrolling
   * document has to reserve the right box for every page up front, including
   * the ones far off screen it will never render, or the scrollbar lies and
   * every scroll jumps as pages resize under it. Cheap: pdf.js reads the page
   * dictionary without rasterising anything, and the answer is cached.
   */
  pageSize(page: number): Promise<PageSize>
  /**
   * Draw `page` into `canvas` at `scale` (1 = the page's intrinsic size).
   * Resolves with the size it was drawn at in CSS pixels.
   *
   * Serialized **per canvas**, not per document: pdf.js refuses two renders
   * onto one canvas, but a stack of pages is a canvas each, and they may draw
   * at the same time. Cancelling across pages — which a single document-wide
   * chain would do — would mean scrolling past a page cancelled the one before
   * it, and a fast scroll would leave a trail of blanks.
   *
   * `offscreen` picks the other of pdf.js's two scheduling modes; see
   * {@link RenderOptions.offscreen}. Anything drawing for the *reader* wants
   * the default; anything drawing into a file must set it.
   */
  render(
    page: number,
    canvas: HTMLCanvasElement,
    scale: number,
    opts?: RenderOptions,
  ): Promise<PageSize>
  destroy(): void
}

export interface RenderOptions {
  /**
   * Draw without waiting on the animation frame — for a raster that is going
   * into a file rather than onto the screen.
   *
   * pdf.js draws a page in slices, and between slices it schedules the next
   * one with `requestAnimationFrame` (its "display" intent). A browser does
   * not fire that in a tab that isn't visible, so a render started in a page
   * the user has just navigated away from — or that has just opened a tab in
   * front of itself, which is exactly what exporting does — **never
   * finishes**. Its "print" intent schedules on a microtask instead and runs
   * wherever it is put.
   *
   * So: on-screen rendering keeps the default, where riding the frame clock is
   * the right thing and throttling a hidden reader is a feature. Export
   * rendering sets this, and stops depending on being looked at.
   */
  offscreen?: boolean
}

/** Bound the backing store: 2× is already crisp, and a score page is big. */
const MAX_DEVICE_SCALE = 2

/**
 * Hard ceiling on one page's backing store, in device pixels.
 *
 * Zoom multiplies the raster, and a canvas costs four bytes a pixel whatever
 * is drawn on it. An A4 page magnified 5× on a retina screen works out at
 * roughly 3900 × 5400 — 20 megapixels, 83 MB — and the reader has two or three
 * of those in the window at once. That is where the scrolling starts to
 * stutter: not the drawing, the memory behind it.
 *
 * Capping costs nothing anyone can see. 12 megapixels still puts an A4 page
 * past 350 dpi, which is finer than the engraving underneath it; beyond that
 * the browser is storing detail the PDF never had.
 */
const MAX_CANVAS_PIXELS = 12_000_000

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
  // canvas is only free once the cancelled task's promise has settled. A
  // resize storm or a zoom produces exactly that overlap on one canvas, so
  // renders are serialized *per canvas*: cancel what's drawing there, wait for
  // it to let go, then draw. A request superseded while it waited returns its
  // size without touching the canvas — nothing is looking at it any more.
  //
  // Per canvas rather than per document, because a scrolling stack draws many
  // pages at once and they don't contend: one chain for the whole document
  // would make scrolling past a page cancel the page before it.
  interface Lane {
    chain: Promise<unknown>
    active: { cancel(): void } | null
    generation: number
  }
  const lanes = new WeakMap<HTMLCanvasElement, Lane>()
  const laneFor = (canvas: HTMLCanvasElement): Lane => {
    let lane = lanes.get(canvas)
    if (!lane) {
      lane = { chain: Promise.resolve(), active: null, generation: 0 }
      lanes.set(canvas, lane)
    }
    return lane
  }
  // Bumped by destroy(), so a teardown abandons every lane at once.
  let closed = false

  const sizes = new Map<number, PageSize>()

  async function draw(
    lane: Lane,
    gen: number,
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number,
    opts: RenderOptions,
  ): Promise<PageSize> {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages))
    const viewport = page.getViewport({ scale: Math.max(scale, 0.01) })
    const size = { width: viewport.width, height: viewport.height }
    if (closed || gen !== lane.generation) return size

    // Device pixels per CSS pixel, backed off until the page fits the ceiling.
    const wanted = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_SCALE)
    const area = viewport.width * viewport.height * wanted * wanted
    const device =
      area > MAX_CANVAS_PIXELS ? wanted * Math.sqrt(MAX_CANVAS_PIXELS / area) : wanted
    canvas.width = Math.max(1, Math.round(viewport.width * device))
    canvas.height = Math.max(1, Math.round(viewport.height * device))

    const task = page.render({
      canvas,
      viewport,
      // See RenderOptions.offscreen: 'print' is the intent that doesn't wait
      // on an animation frame, which a hidden tab never gives it.
      ...(opts.offscreen ? { intent: 'print' as const } : {}),
      // The device-pixel upscale, handed to pdf.js rather than applied to the
      // context ourselves — it owns the context for the length of the render.
      ...(device === 1 ? {} : { transform: [device, 0, 0, device, 0, 0] }),
    })
    lane.active = task
    try {
      await task.promise
    } catch (e) {
      // A cancelled render is the ordinary outcome of a zoom or a resize: the
      // next one is already queued behind it, not an error to report.
      if (!(e instanceof Error && e.name === 'RenderingCancelledException')) throw e
    } finally {
      if (lane.active === task) lane.active = null
    }
    return size
  }

  return {
    pageCount: doc.numPages,
    async pageSize(pageNumber) {
      const n = Math.min(Math.max(1, Math.round(pageNumber)), doc.numPages)
      const cached = sizes.get(n)
      if (cached) return cached
      const viewport = (await doc.getPage(n)).getViewport({ scale: 1 })
      const size = { width: viewport.width, height: viewport.height }
      sizes.set(n, size)
      return size
    },
    render(pageNumber, canvas, scale, opts = {}) {
      const lane = laneFor(canvas)
      const gen = ++lane.generation
      lane.active?.cancel()
      const run = lane.chain.then(() => draw(lane, gen, pageNumber, canvas, scale, opts))
      // The chain must never reject, or one failed page would wedge every
      // later render onto that canvas behind it.
      lane.chain = run.then(
        () => undefined,
        () => undefined,
      )
      return run
    },
    destroy() {
      closed = true
      void loading.destroy()
    },
  }
}
