// GET /api/admin/blobs?path=<prefix> — one level of the Blob store, for the
// console's Storage tab: the folders and files directly under `path`, each
// folder with the bytes and file count of everything beneath it.
//
// Gated exactly like the other two admin routes: ADMIN_EMAILS server-side,
// 404 for everyone else. Read-only — the store is deleted from by the purge
// paths, never from here.
//
// Blob has no folders, only pathnames, and its "folded" listing names the
// folders without sizing them. A size per folder is the one number an admin
// opening this tab wants (the store is 90% stem WAVs — memory, 2026-09), so
// this walks every object under the prefix flat and aggregates by the next
// path segment. At a thousand-odd objects that is two calls; PAGE_CAP bounds
// it on a store that has grown past what a page can wait for, and the
// response says so.
import { list } from '@vercel/blob'
import { getUid, isAdmin, listUsers } from '../_lib/auth.js'
import { sql } from '../_lib/db.js'
import { isGuestOwner } from '../_lib/guest.js'
import { json, err } from '../_lib/respond.js'

const PAGE_CAP = 25

export interface BlobFolder {
  name: string
  bytes: number
  count: number
  /** Newest upload beneath it, ms. */
  newest: number
}
export interface BlobFile {
  name: string
  pathname: string
  url: string
  size: number
  uploadedAt: number
}
export interface BlobListing {
  path: string
  folders: BlobFolder[]
  files: BlobFile[]
  bytes: number
  count: number
  /** PAGE_CAP was hit: the numbers are a floor, not a total. */
  truncated: boolean
  /** What a folder's name means, where it is an id: an account's name or
   *  email under `users/`, a project's title two levels down. */
  labels: Record<string, string>
}

/**
 * Names for the ids the store is organised by. Every prefix is
 * `users/{uid}/{kind}/{projectId}/…`, so a folder called `user_…` is an
 * account and one called by a 12-character id (or a legacy uuid) is a
 * project — and a store browsed by raw ids answers "which folder is eating
 * the space?" with a string nobody can place. Looked up in one query each,
 * only for the names on this screen; a name with no row (a purged project
 * whose bytes outlived it, exactly the case worth spotting) gets no label.
 */
async function labelsFor(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (names.length === 0) return out
  const guests = names.filter(isGuestOwner)
  for (const g of guests) out[g] = 'guest'
  const accounts = names.filter((n) => n.startsWith('user_'))
  const maybeProjects = names.filter((n) => !isGuestOwner(n) && !n.startsWith('user_'))
  if (accounts.length)
    for (const u of await listUsers())
      if (accounts.includes(u.uid)) out[u.uid] = u.name || u.email || u.uid
  if (maybeProjects.length) {
    type Row = { id: string; title: string; deleted_at: unknown }
    const rows = (await sql`
      SELECT id, title, deleted_at FROM projects WHERE id = ANY(${maybeProjects})
    `) as unknown as Row[]
    for (const r of rows)
      out[r.id] = `${r.title || 'Untitled'}${r.deleted_at != null ? ' (in the trash)' : ''}`
  }
  return out
}

export async function GET(request: Request): Promise<Response> {
  const uid = await getUid(request)
  if (!uid || !(await isAdmin(uid))) return err(404, 'Not found')

  let path = new URL(request.url).searchParams.get('path') ?? ''
  path = path.replace(/^\/+/, '')
  if (path && !path.endsWith('/')) path += '/'

  const folders = new Map<string, BlobFolder>()
  const files: BlobFile[] = []
  let bytes = 0
  let count = 0
  let truncated = false
  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page === PAGE_CAP) {
      truncated = true
      break
    }
    const res = await list({ prefix: path, cursor, limit: 1000 })
    for (const b of res.blobs) {
      if (!b.pathname.startsWith(path)) continue
      const rest = b.pathname.slice(path.length)
      const slash = rest.indexOf('/')
      const at = b.uploadedAt.getTime()
      bytes += b.size
      count += 1
      if (slash === -1) {
        files.push({ name: rest, pathname: b.pathname, url: b.url, size: b.size, uploadedAt: at })
        continue
      }
      const name = rest.slice(0, slash)
      const f = folders.get(name)
      if (f) {
        f.bytes += b.size
        f.count += 1
        if (at > f.newest) f.newest = at
      } else folders.set(name, { name, bytes: b.size, count: 1, newest: at })
    }
    if (!res.hasMore) break
    cursor = res.cursor
  }

  const listing: BlobListing = {
    path,
    folders: [...folders.values()].sort((a, b) => b.bytes - a.bytes),
    files: files.sort((a, b) => b.uploadedAt - a.uploadedAt),
    bytes,
    count,
    truncated,
    labels: await labelsFor([...folders.keys()]),
  }
  return json(listing)
}
