// Clone a shared project into the signed-in user's own account ("make a copy"
// from the read-only viewer). The copy gets a fresh doc id and *owns its
// bytes*: the audio blob and every note image are re-uploaded under the new
// owner's Storage path, so the copy keeps working even if the original is
// unshared or deleted. Note ids are kept as-is — @mentions in note HTML link
// notes by id, and the id also seeds each note's fallback colour.
import { uploadAudio } from './audioCloud'
import { uploadNoteImage } from './imageCloud'
import { fetchProjects, saveProject } from './projectStore'
import { TEXT_BLOCK, type TextBlockData } from './noteBlocks'
import type { Annotation, Project } from '../types'

/**
 * Vercel Blob URLs for note images embedded in note HTML
 * (`https://{store}.public.blob.vercel-storage.com/users/{uid}/images/…`).
 * Matched against the raw HTML; blob URLs carry no query string, but escAmp
 * handling below is kept for safety with any legacy URLs still embedded.
 */
const IMAGE_URL_RE =
  /https:\/\/[^\s"'<>]*\.public\.blob\.vercel-storage\.com\/users\/[^\s"'<>]*\/images\/[^\s"'<>]+/g

/** TipTap escapes `&` in attribute values — the form a URL takes inside HTML. */
const escAmp = (url: string) => url.replaceAll('&', '&amp;')

/** Every image download URL referenced in the HTML, decoded back to raw form. */
function imageUrlsIn(html: string): string[] {
  return (html.match(IMAGE_URL_RE) ?? []).map((u) => u.replaceAll('&amp;', '&'))
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
  return {
    ...a,
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
  /**
   * What to do when the source audio can't be downloaded. `'fail'` (default)
   * aborts the whole copy — right for live shares, where a copy with broken
   * audio is worse than no copy. `'detach'` keeps the copy but drops the dead
   * audioUrl, so the editor offers its re-attach flow — right for imports of
   * older exports whose original bytes may be long gone.
   */
  onMissingAudio?: 'fail' | 'detach'
}

/**
 * Copy a (shared) project into `uid`'s account and resolve with the saved
 * copy (id, ownerId, etc. populated). `onStatus` receives short progress
 * labels for the UI. Audio is copied strictly by default (see
 * {@link CopyProjectOptions.onMissingAudio}); images are best-effort — one
 * that can't be fetched keeps its original URL.
 */
export async function copySharedProject(
  uid: string,
  src: Project,
  onStatus?: (label: string) => void,
  opts?: CopyProjectOptions,
): Promise<Project> {
  const newId = crypto.randomUUID()

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

  // Audio: re-upload the blob under the new owner's path. YouTube sources are
  // just metadata and copy as-is.
  let source = src.source
  if (source?.type === 'audio' && source.audioUrl) {
    onStatus?.('Copying audio…')
    try {
      const blob = await fetchBlob(source.audioUrl)
      const audioUrl = await uploadAudio(uid, newId, blob, (f) =>
        onStatus?.(`Copying audio… ${Math.round(f * 100)}%`),
      )
      source = { ...source, audioUrl }
    } catch (err) {
      if (opts?.onMissingAudio !== 'detach') throw err
      // The referenced audio is gone (source project deleted, etc.) — keep the
      // copy but drop the URL, so opening it lands on the re-attach prompt.
      console.error('Source audio unavailable — copying without it:', err)
      source = { type: source.type, fileName: source.fileName }
    }
  }

  // Note images: re-upload each referenced image and map old URL → new.
  const urls = [...new Set(src.annotations.flatMap((a) => htmlOf(a).flatMap(imageUrlsIn)))]
  const urlMap = new Map<string, string>()
  if (urls.length > 0) {
    onStatus?.('Copying images…')
    await Promise.all(
      urls.map(async (url) => {
        try {
          urlMap.set(url, await uploadNoteImage(uid, newId, await fetchBlob(url)))
        } catch (err) {
          // Keep the original URL — the image still renders while it exists.
          console.error('Failed to copy note image:', err)
        }
      }),
    )
  }

  onStatus?.('Saving…')
  const copy: Project = {
    id: newId,
    ownerId: uid,
    title,
    source,
    annotations: src.annotations.map((a) => rewriteAnnotation(a, urlMap)),
    // Settings travel with the copy — they carry presentation prefs and the
    // project kind (a song-structure copy must open as a structure board).
    settings: src.settings,
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
