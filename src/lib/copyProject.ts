// Clone a shared project into the signed-in user's own account ("make a copy"
// from the read-only viewer). The copy gets a fresh doc id and owns the bytes
// we host: every note image is re-uploaded under the new owner's Storage path,
// so it survives the original being unshared or deleted. The *source* is only
// a link now (YouTube, or a direct audio URL), so it's copied verbatim and
// both projects point at the same audio — if that link dies, both lose it.
// Note ids are kept as-is — @mentions in note HTML link notes by id, and the
// id also seeds each note's fallback colour.
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

/**
 * Copy a (shared) project into `uid`'s account and resolve with the saved
 * copy (id, ownerId, etc. populated). `onStatus` receives short progress
 * labels for the UI. Images are best-effort — one that can't be fetched keeps
 * its original URL. A same-owner copy stays in the source's folder; a
 * cross-owner copy (from the share viewer) lands in the root.
 */
export async function copySharedProject(
  uid: string,
  src: Project,
  onStatus?: (label: string) => void,
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

  // Both source kinds are now just a link (YouTube or a direct audio URL), so
  // the source copies as-is — a copy points at the same audio the original
  // does. Note images still get duplicated below: those we host, and they'd
  // die with the original owner's project.
  const source = src.source

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
    // Freshest updatedAt → the app opens the copy first after the redirect.
    updatedAt: Date.now(),
    shared: false,
    // Same-account copies stay in the source's folder; cross-account copies
    // (the share viewer) land in the root — the source's folder id is the
    // original owner's and means nothing in the recipient's library.
    folderId: src.ownerId === uid ? src.folderId ?? null : null,
  }
  await saveProject(uid, copy)
  return copy
}
