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
