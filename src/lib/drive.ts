/**
 * Google Drive video sources — the second way a track gets a video.
 *
 * Drive has no embeddable player with a JS API the way YouTube does. Its
 * `/preview` iframe plays a file but hands out no clock, and a clock is the
 * whole app: without `currentTime`/`seekTo` a note can't anchor to a moment.
 * So DrivePlayer loads the file's bytes into a plain `<video>` element
 * instead, which gives us the real thing.
 *
 * **Those bytes cannot come from Drive directly.** Drive refuses its download
 * endpoint to browsers on two independent grounds, and page JS can suppress
 * neither:
 *
 *  • Every subresource loaded from another origin carries
 *    `Sec-Fetch-Site: cross-site`. Drive answers that **403**, whatever the
 *    file is — size, sharing and `confirm=t` don't enter into it.
 *  • Any `Referer` from a non-Google page gets Drive's "Virus scan warning"
 *    HTML instead of the file, `confirm=t` notwithstanding.
 *
 * Either way the `<video>` receives HTML and reports `MEDIA_ELEMENT_ERROR:
 * Format error`, which looks exactly like a corrupt file and is not one.
 *
 * A *server* fetch sends neither header, so the bytes come through our own
 * origin instead: `driveStreamUrl` points at `GET /api/browse?drive=<id>`,
 * which proxies Drive with Range support. Two things that follow:
 *
 *  • **The file must still be shared "Anyone with the link."** The proxy has
 *    no Drive credentials; a private file comes back as a sign-in page, which
 *    it turns into a 502 rather than passing HTML off as video.
 *  • **Every play spends our bandwidth**, unlike YouTube's embed. The proxy
 *    serves ~8 MB per request and only for file ids a live project points at,
 *    so it can't be used as a general-purpose CDN for public Drive files.
 *
 * One door this opens and we haven't walked through: the proxy is same-origin,
 * so it *could* feed wavesurfer, which Drive's own no-CORS bytes never could.
 * A Drive track is still its own source kind rather than an `audio` one — see
 * AudioUrlForm for the other side of that rule.
 */

/** Drive file ids are long opaque strings; the length floor keeps a stray
 *  11-char YouTube id from being read as one. */
const FILE_ID = /^[a-zA-Z0-9_-]{16,}$/

const DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'drive.usercontent.google.com',
])

/** Whether a link is aimed at Drive at all — used to answer a bad paste with
 *  the Drive-shaped complaint ("that's a folder") rather than the YouTube one. */
export function looksLikeDriveLink(input: string): boolean {
  try {
    return DRIVE_HOSTS.has(new URL(input.trim()).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Extract a Drive file id from any of the link shapes Drive hands out — the
 * share dialog's `/file/d/{id}/view`, the older `open?id=`/`uc?id=` forms, and
 * the `drive.usercontent.google.com/download?id=` URL our own player uses (so
 * a link copied back out of the app round-trips).
 *
 * Deliberately URL-only: unlike a YouTube id, a bare Drive id is unguessable
 * from a paste, and accepting one would swallow anything long enough.
 */
export function parseDriveFileId(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (!DRIVE_HOSTS.has(url.hostname.toLowerCase())) return null
  // A folder link names a folder, not a file. Bail rather than mint a track
  // pointing at an id that can never stream.
  if (/^\/drive\/(u\/\d+\/)?folders\//.test(url.pathname)) return null
  const inPath = url.pathname.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]+)/)
  if (inPath && FILE_ID.test(inPath[1])) return inPath[1]
  const inQuery = url.searchParams.get('id')
  return inQuery && FILE_ID.test(inQuery) ? inQuery : null
}

/** The URL a `<video>` element streams the file from — our own proxy, never
 *  Drive. See the note up top for why pointing the element at Drive can only
 *  fail; api/browse.ts holds the other half. */
export function driveStreamUrl(fileId: string): string {
  return `/api/browse?drive=${encodeURIComponent(fileId)}`
}

/** The human-facing Drive page — the "open the original" link. */
export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`
}

/** Drive's poster image for the file — a plain image URL (no API, no CORS
 *  needed), so it drops straight into a tile's cover well like a YouTube
 *  thumb. Only renders for link-shared files; a 403 falls through to the
 *  generated waveform mark, exactly as a dead YouTube thumb does. */
export function driveThumbUrl(fileId: string, width = 640): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(
    fileId,
  )}&sz=w${width}`
}
