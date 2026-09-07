// Where the app's own pages are. There is no router — every route is a query
// param on one page (?track=, ?view=, ?browse=1, ?admin=1) — so "go home"
// means dropping the query, and that rule lives here rather than being spelled
// out at each masthead.

/**
 * The home page: the pathname with no query. Not "/", so a deployment served
 * from a sub-path lands on its own root.
 *
 * Signed in that's the library; signed out it's the landing page, which also
 * lists the guest tracks this device holds keys to.
 */
export const homeHref = (): string => window.location.pathname

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
  } catch {
    // A bad URL or a blocked history call is cosmetic here — the long link
    // works exactly as well, so never let this break loading a track.
  }
}
