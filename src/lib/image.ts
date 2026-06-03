/**
 * Downscale a large image File to a JPEG Blob, so pasted screenshots stay small
 * before they're uploaded to Cloud Storage. Small, already-small images pass
 * through untouched. Returning a Blob (not a data URL) keeps the bytes out of
 * the note HTML — only the resulting Storage download URL goes inline.
 */
export async function fileToScaledBlob(
  file: File,
  maxDim = 1280,
  quality = 0.85,
): Promise<Blob> {
  const original = await readAsDataUrl(file)
  const img = await loadImage(original)
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height))

  // Small + already-scaled images can be uploaded as-is.
  if (scale === 1 && file.size < 300_000) return file

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvasToBlob(canvas, quality)
}

/**
 * Read any Blob into a data URL. Used as the fallback when an upload fails — the
 * image is kept inline rather than lost (degrading to the pre-Cloud behaviour).
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return readAsDataUrl(blob)
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob returned null'))),
      'image/jpeg',
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
