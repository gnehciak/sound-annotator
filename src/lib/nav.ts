// The app's router.
//
// There is still no <Router>: every place in the app is a query param on one
// page, because a project id *is* a share credential and `?view=<id>` links
// are already out in the world. What changed is that the query is now the
// single source of truth for where you are — the library, a folder, the trash,
// the Browse gallery, a track — instead of React state that the address bar
// only sometimes heard about. So every navigation leaves a history entry, and
// Back (or a swipe from the edge of a phone screen) returns to the last place
// rather than dumping the user out of the app.
//
// Anything that navigates goes through `navigate()`; anything that needs to
// know where it is calls `useRoute()`. Parsing and serialising live here so
// the two can never drift.
import { useSyncExternalStore } from 'react'

/** Where the user is. Exactly one of these is true at any moment. */
export type Route =
  /** The signed-in library: the root, or one folder drilled into. */
  | { page: 'library'; folder: string | null }
  /** The published-track gallery. Signed in that's a tab of the home page;
   *  signed out it's the landing page, which carries the same gallery. */
  | { page: 'browse' }
  /** The trash — a destination beside the folders, never one of them. */
  | { page: 'trash' }
  /** The editor. `key` is a guest's capability token; `admin` is the console's
   *  hand-off flag (see App's loader). Both ride along untouched. */
  | { page: 'track'; id: string; key: string | null; admin: boolean }
  /** A `?view=` share link: the read-only viewer, no sign-in. */
  | { page: 'share'; id: string }
  /** The admin console and which of its two tabs is showing. */
  | { page: 'admin'; tab: 'projects' | 'users' }

/** The library root — the app's home, and the fallback for a dead link. */
export const HOME: Route = { page: 'library', folder: null }

/**
 * Read a Route out of a query string.
 *
 * Order is precedence: a share link wins over everything, `?track=` beats
 * `?admin=1` (that pair is the console's "edit this project" hand-off, which
 * wants the editor), and an unrecognised query is simply the library.
 */
export function parseRoute(search: string = window.location.search): Route {
  const p = new URLSearchParams(search)
  const view = p.get('view')
  if (view) return { page: 'share', id: view }
  const track = p.get('track')
  if (track)
    return {
      page: 'track',
      id: track,
      key: p.get('key'),
      admin: p.get('admin') === '1',
    }
  if (p.get('admin') === '1')
    return { page: 'admin', tab: p.get('tab') === 'users' ? 'users' : 'projects' }
  if (p.get('trash') === '1') return { page: 'trash' }
  if (p.get('browse') === '1') return { page: 'browse' }
  return { page: 'library', folder: p.get('folder') || null }
}

/** The query string for a route, leading `?` included (empty at the root). */
export function routeSearch(r: Route): string {
  const p = new URLSearchParams()
  switch (r.page) {
    case 'library':
      if (r.folder) p.set('folder', r.folder)
      break
    case 'browse':
      p.set('browse', '1')
      break
    case 'trash':
      p.set('trash', '1')
      break
    case 'track':
      p.set('track', r.id)
      if (r.key) p.set('key', r.key)
      if (r.admin) p.set('admin', '1')
      break
    case 'share':
      p.set('view', r.id)
      break
    case 'admin':
      p.set('admin', '1')
      if (r.tab === 'users') p.set('tab', 'users')
      break
  }
  const q = p.toString()
  return q ? `?${q}` : ''
}

/**
 * The full href for a route. Built on `location.pathname`, not "/", so a
 * deployment served from a sub-path keeps its prefix.
 */
export const routeHref = (r: Route): string =>
  window.location.pathname + routeSearch(r)

/**
 * The home page: the pathname with no query.
 *
 * Signed in that's the library; signed out it's the landing page, which also
 * lists the guest tracks this device holds keys to.
 */
export const homeHref = (): string => routeHref(HOME)

// Subscribers are woken by the browser's own popstate (Back/forward, swipe)
// and by this event, which `navigate` fires because push/replaceState
// deliberately don't.
const NAV_EVENT = 'sound-annotator:navigate'

/**
 * Go somewhere. `push` leaves a history entry (the default — that's what makes
 * Back work); `replace` rewrites the current one, for corrections the user
 * never chose, like a dead deep link falling back home.
 */
export function navigate(r: Route, mode: 'push' | 'replace' = 'push'): void {
  const href = routeHref(r)
  if (href === window.location.pathname + window.location.search) return
  const state = { page: r.page }
  if (mode === 'push') window.history.pushState(state, '', href)
  else window.history.replaceState(state, '', href)
  window.dispatchEvent(new Event(NAV_EVENT))
}

// Parsed route, memoised on the query it came from: useSyncExternalStore polls
// the snapshot and would loop forever on a fresh object every call.
let cachedSearch: string | null = null
let cachedRoute: Route = HOME

function snapshot(): Route {
  const search = window.location.search
  if (cachedSearch !== search) {
    cachedSearch = search
    cachedRoute = parseRoute(search)
  }
  return cachedRoute
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAV_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAV_EVENT, onChange)
  }
}

/** Where we are, re-rendering on Back/forward and on every `navigate`. */
export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * Resolve a URL's project id against a list.
 *
 * A project has two public names — its `id` and, for rows that predate short
 * ids, the short `alias` we hand out instead (see lib/ids.ts) — and either can
 * be what's in the address bar. Matching on `id` alone would make Back out of
 * a legacy project look like a dead link.
 */
export function resolveProject<T extends { id: string; alias?: string }>(
  projects: readonly T[],
  param: string | null,
): T | null {
  if (!param) return null
  return projects.find((p) => p.id === param || p.alias === param) ?? null
}

/**
 * Rewrite the id in the address bar to the project's short public id.
 *
 * Old links carry a 36-character uuid key and keep resolving forever, but
 * they're the long form the user was complaining about — so once the project
 * is loaded and we know its short id, quietly swap it in. `replaceState` means
 * no reload, no history entry and no redirect round-trip: the page is already
 * the right page, only its address was verbose. Copying from the address bar
 * then yields the short link.
 *
 * A no-op when the URL already carries the short id, which is the common case.
 */
export function canonicalizeProjectParam(
  param: 'view' | 'track',
  project: { id: string; alias?: string },
): void {
  try {
    const url = new URL(window.location.href)
    const short = project.alias || project.id
    if (url.searchParams.get(param) === short) return
    url.searchParams.set(param, short)
    window.history.replaceState(window.history.state, '', url.toString())
    // Same page, new spelling — but subscribers hold a route parsed from the
    // old one, and the id in it is what they compare against.
    window.dispatchEvent(new Event(NAV_EVENT))
  } catch {
    // A bad URL or a blocked history call is cosmetic here — the long link
    // works exactly as well, so never let this break loading a track.
  }
}
