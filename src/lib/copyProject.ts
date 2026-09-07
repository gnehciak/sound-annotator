// Clone a shared project into the signed-in user's own account ("make a copy"
// from the read-only viewer). The copy gets a fresh doc id and owns the bytes
// we host: every note image — and an uploaded PDF score — is re-uploaded under
// the new owner's Storage path, so it survives the original being unshared or
// deleted. (A *Drive* score is a link like the source, so it copies verbatim
// and both tracks follow the same file.) The *source* is only
// a link now (YouTube, Google Drive, or a direct audio URL), so it's copied
// verbatim and both projects point at the same audio — if that link dies, both
// lose it.
// Note ids are kept as-is — @mentions in note HTML link notes by id, and the
// id also seeds each note's fallback colour.
import { uploadNoteImage } from './imageCloud'
import { uploadScorePdf } from './scoreCloud'
import { withScore } from './score'
import { fetchProjects, saveProject } from './projectStore'
import { TEXT_BLOCK, type TextBlockData } from './noteBlocks'
import { coverUrls } from './overlays'
import type { Annotation, Project } from '../types'
import { newId } from './ids'

/**
 * Vercel Blob URLs for note images embedded in note HTML
 * (`https://{store}.public.blob.vercel-storage.com/users/{uid}/images/…`).
 * Matched against the raw HTML; blob URLs carry no query string, but escAmp
 * handling below is kept for safety with any legacy URLs still embedded.
 */
const IMAGE_URL_RE =
  /https:\/\/[^\s"'<>]*\.public\.blob\.vercel-storage\.com\/users\/[^\s"'<>]*\/images\/[^\s"'<>]+/g

/**
 * An image carried *inside* the HTML as a base64 payload rather than as a link
 * to bytes we already host. Nothing in the app writes these — the editor
 * uploads what you paste — but a hand-authored track file has nowhere else to
 * put an image, so a `data:` URI is the only way one can arrive self-contained.
 * They're re-hosted exactly like a blob URL below, which is the point: the
 * inline copy exists only until the import turns it into a real note image.
 */
const DATA_IMAGE_RE = /data:image\/(?:png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+/g

/** TipTap escapes `&` in attribute values — the form a URL takes inside HTML. */
const escAmp = (url: string) => url.replaceAll('&', '&amp;')

/**
 * Every image source referenced in the HTML, decoded back to raw form: blob
 * URLs we host, and inline `data:` payloads a hand-authored file brought with
 * it. Both are fetchable with `fetch()`, which is all the copy below needs.
 */
function imageUrlsIn(html: string): string[] {
  return [
    ...(html.match(IMAGE_URL_RE) ?? []).map((u) => u.replaceAll('&amp;', '&')),
    ...(html.match(DATA_IMAGE_RE) ?? []),
  ]
}

/** Swap old image URLs for the re-uploaded ones (both escaped and raw forms). */
function rewriteHtml(html: string, urlMap: Map<string, string>): string {
  let out = html
  for (const [oldUrl, newUrl] of urlMap) {
    out = out
      .replaceAll(escAmp(oldUrl), escAmp(newUrl))
      .replaceAll(oldUrl, newUrl)
  }
  return out
}

/** All HTML carried by a note: the legacy field plus every text block. */
function htmlOf(a: Annotation): string[] {
  return [
    a.contentHtml ?? '',
    ...(a.blocks ?? [])
      .filter((b) => b.type === TEXT_BLOCK)
      .map((b) => (b.data as Partial<TextBlockData>)?.html ?? ''),
  ]
}

function rewriteAnnotation(a: Annotation, urlMap: Map<string, string>): Annotation {
  if (urlMap.size === 0) return a
  // The note's cover image is referenced by URL, not embedded in HTML, so it
  // gets swapped by lookup rather than by string replacement.
  const coverUrl = a.overlay?.coverUrl
  const nextCover = coverUrl ? urlMap.get(coverUrl) ?? coverUrl : undefined
  return {
    ...a,
    ...(a.overlay ? { overlay: { ...a.overlay, ...(nextCover ? { coverUrl: nextCover } : {}) } } : {}),
    contentHtml: rewriteHtml(a.contentHtml ?? '', urlMap),
    blocks: a.blocks?.map((b) =>
      b.type === TEXT_BLOCK
        ? {
            ...b,
            data: {
              ...(b.data as TextBlockData),
              html: rewriteHtml((b.data as Partial<TextBlockData>)?.html ?? '', urlMap),
            },
          }
        : b,
    ),
  }
}

/** First of "Title", "Title (2)", "Title (3)", … that isn't already taken. */
function untakenTitle(title: string, taken: Set<string>): string {
  if (!taken.has(title)) return title
  for (let x = 2; ; x++) {
    const t = `${title} (${x})`
    if (!taken.has(t)) return t
  }
}

/** Download a blob via its public URL (Blob storage allows cross-origin GET). */
async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  return res.blob()
}

export interface CopyProjectOptions {
  /**
   * Folder the copy lands in. Defaults to the source's folder for a
   * same-owner copy, the root otherwise (a foreign folder id means nothing
   * in the recipient's library).
   */
  folderId?: string | null
}

/**
 * Copy a (shared) project into `uid`'s account and resolve with the saved
 * copy (id, ownerId, etc. populated). `onStatus` receives short progress
 * labels for the UI. The source is only a link now, so it copies verbatim and
 * costs nothing; images are best-effort — one that can't be fetched keeps its
 * original URL.
 */
export async function copySharedProject(
  uid: string,
  src: Project,
  onStatus?: (label: string) => void,
  opts?: CopyProjectOptions,
): Promise<Project> {
  const copyId = newId()

  // De-dupe the title against the user's existing tracks: a name that's already
  // taken becomes "Title (2)" / "(3)" / … Best-effort — purely cosmetic, so a
  // failed listing never blocks the copy.
  const taken = new Set(
    await fetchProjects(uid).then(
      (ps) => ps.map((p) => p.title),
      () => [],
    ),
  )
  const title = untakenTitle(src.title, taken)

  // Every source kind is now just a link (YouTube, Drive, or a direct audio
  // URL), so the source copies as-is — a copy points at the same audio the
  // original does. Nothing is fetched here, so a copy can't fail on dead audio:
  // a link that has rotted simply lands the copy on the re-attach prompt, which
  // is what the old `onMissingAudio: 'detach'` existed to arrange.
  const source = src.source

  // Note images: re-upload each referenced image and map old URL → new. Both
  // the ones embedded in note HTML and the notes' video cover images, which
  // live in the same Blob folder but are referenced from `overlay.coverUrl`.
  const urls = [
    ...new Set([
      ...src.annotations.flatMap((a) => htmlOf(a).flatMap(imageUrlsIn)),
      ...coverUrls(src.annotations),
    ]),
  ]
  const urlMap = new Map<string, string>()
  if (urls.length > 0) {
    onStatus?.('Copying images…')
    await Promise.all(
      urls.map(async (url) => {
        try {
          urlMap.set(url, await uploadNoteImage(uid, copyId, await fetchBlob(url)))
        } catch (err) {
          // Keep the original URL — the image still renders while it exists.
          console.error('Failed to copy note image:', err)
        }
      }),
    )
  }

  // An uploaded score is bytes we host, so the copy takes its own: leaving the
  // URL pointing at the original's blob would blank the copy the day that
  // project is purged. A Drive score is a link and needs nothing.
  let settings = src.settings
  const score = settings?.score
  if (score?.kind === 'blob' && score.url) {
    onStatus?.('Copying score…')
    try {
      const pdf = await fetchBlob(score.url)
      const name = score.fileName ?? 'score.pdf'
      const url = await uploadScorePdf(
        uid,
        copyId,
        new File([pdf], name, { type: 'application/pdf' }),
      )
      settings = withScore(settings, { ...score, url })
    } catch (err) {
      // Keep the original URL — the score still loads while it exists.
      console.error('Failed to copy the score:', err)
    }
  }

  onStatus?.('Saving…')
  const copy: Project = {
    id: copyId,
    ownerId: uid,
    title,
    source,
    annotations: src.annotations.map((a) => rewriteAnnotation(a, urlMap)),
    // Settings travel with the copy — they carry presentation prefs, the
    // project kind (a song-structure copy must open as a structure board) and
    // the score, whose URL was just rewritten if we re-hosted it.
    settings,
    // Freshest updatedAt → the app opens the copy first after the redirect.
    updatedAt: Date.now(),
    shared: false,
    // An explicit destination (import) wins; otherwise same-account copies
    // stay in the source's folder and cross-account copies (the share viewer)
    // land in the root — the source's folder id is the original owner's and
    // means nothing in the recipient's library.
    folderId:
      opts?.folderId !== undefined
        ? opts.folderId
        : src.ownerId === uid
          ? src.folderId ?? null
          : null,
  }
  await saveProject(uid, copy)
  return copy
}
