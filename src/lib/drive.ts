/**
 * Google Drive video sources — the second way a track gets a video.
 *
 * Drive has no embeddable player with a JS API the way YouTube does. Its
 * `/preview` iframe plays a file but hands out no clock, and a clock is the
 * whole app: without `currentTime`/`seekTo` a note can't anchor to a moment.
 * So DrivePlayer loads Drive's own file bytes into a plain `<video>` element
 * instead, which gives us the real thing. Three consequences worth carrying
 * in your head:
 *
 *  • **The file must be shared "Anyone with the link."** Drive answers the
 *    download endpoint for a private file with a sign-in page, not video, and
 *    the `<video>` simply fails to load. DrivePlayer says exactly that rather
 *    than spinning forever, because it's the one thing the teacher can fix.
 *  • **`confirm=t` is load-bearing.** Past roughly 100 MB Drive answers the
 *    plain download URL with its "can't scan this for viruses" interstitial
 *    instead of the file; a lecture recording is always past it.
 *  • **Drive sends no CORS header.** Fine for `<video>` (media elements load
 *    cross-origin without one), fatal for wavesurfer — which is why a Drive
 *    track is its own source kind rather than an `audio` one with a rewritten
 *    URL. See AudioUrlForm for the other side of that rule.
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

/** The URL a `<video>` element streams the file from. See the note up top for
 *  why it's the download endpoint and why `confirm=t` has to be on it. */
export function driveStreamUrl(fileId: string): string {
  return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(
    fileId,
  )}&export=download&confirm=t`
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
