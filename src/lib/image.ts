/**
 * Downscale a large image File before upload, so pasted screenshots and phone
 * photos stay small. Returning a Blob (not a data URL) keeps the bytes out of
 * the note HTML — only the resulting Storage download URL goes inline.
 *
 * Two things this is careful about, both of which bit the naive version:
 *
 *  • **Transparency.** Re-encoding a PNG screenshot as JPEG fills every
 *    transparent pixel black — rounded window corners come back with black
 *    wedges. Sources that can carry alpha are encoded as WebP instead, which
 *    keeps it and is still far smaller than the PNG. Photographic sources stay
 *    JPEG, which beats WebP on nothing but universality — and universality is
 *    why it remains the fallback when a browser can't encode WebP at all.
 *
 *  • **Memory.** The old path read the whole file into a base64 data URL just
 *    to hand it to an <img>, which for a 12 MP phone photo is several MB of
 *    string on top of the decoded bitmap. `createImageBitmap` decodes the File
 *    directly and applies the EXIF rotation that phones rely on, so portrait
 *    photos stop arriving sideways.
 */
export async function fileToScaledBlob(
  file: File,
  maxDim = 1280,
  quality = 0.85,
): Promise<Blob> {
  const img = await decode(file)
  const w = 'width' in img ? img.width : 0
  const h = 'height' in img ? img.height : 0
  const scale = Math.min(1, maxDim / Math.max(w, h))

  // Small + already-scaled images can be uploaded as-is.
  if (scale === 1 && file.size < 300_000) {
    close(img)
    return file
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    close(img)
    return file
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  close(img)

  const type = await encodingFor(file.type)
  const out = await canvasToBlob(canvas, type, quality)
  // Re-encoding can lose: a small flat PNG may come out bigger than it went in.
  // Keep whichever is actually smaller, as long as we didn't need to resize.
  return scale === 1 && out.size >= file.size ? file : out
}

/**
 * Read any Blob into a data URL. Used as the fallback when an upload fails — the
 * image is kept inline rather than lost (degrading to the pre-Cloud behaviour).
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return readAsDataUrl(blob)
}

/** Source types that can carry transparency we must not flatten. */
const ALPHA_TYPES = new Set(['image/png', 'image/webp', 'image/gif', 'image/avif'])

/** The output type for a given source type, given what this browser can encode. */
async function encodingFor(sourceType: string): Promise<'image/webp' | 'image/jpeg'> {
  return ALPHA_TYPES.has(sourceType) && (await canEncodeWebp())
    ? 'image/webp'
    : 'image/jpeg'
}

let webpSupport: Promise<boolean> | null = null
/**
 * Does canvas encode WebP here? Asked once. This matters because `toBlob` with
 * an unsupported type doesn't fail — it silently falls back to PNG, which for a
 * screenshot is *larger* than the original and would quietly undo the whole
 * point of this module.
 */
function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= (async () => {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      return c.toDataURL('image/webp').startsWith('data:image/webp')
    } catch {
      return false
    }
  })()
  return webpSupport
}

type Decoded = ImageBitmap | HTMLImageElement

/** Decode a File, preferring createImageBitmap (cheap, EXIF-aware). */
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // Older Safari rejects the options bag, and some codecs aren't wired to
      // createImageBitmap at all — fall through to the <img> path.
    }
  }
  return loadImage(await readAsDataUrl(file))
}

function close(img: Decoded): void {
  if ('close' in img) img.close()
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      type,
      quality,
    )
  })
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}
