// "Is the signed-in account an admin?" — for the UI only.
//
// The allowlist is ADMIN_EMAILS, which is server-only and never reaches the
// client bundle, so the browser genuinely cannot work this out for itself. It
// asks instead: /api/admin/projects?whoami=1 answers 200 to an admin and 404
// to everyone else, which is the same gate the real endpoints use.
//
// This decides whether a *button is drawn*, nothing more. Every admin-only
// route re-checks server-side on every call, so a client that forced this to
// true would get a 404 the moment it tried to use it — the honest failure, and
// the reason it's safe to keep the answer in the browser at all.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api'
import { useAuth } from './auth'

/** Asked once per page load, then shared — this is called from several trees. */
let pending: Promise<boolean> | null = null

function probe(): Promise<boolean> {
  pending ??= api<{ admin: boolean }>('/api/admin/projects?whoami=1')
    .then((r) => r.admin === true)
    .catch((e) => {
      // 404 is the deliberate answer to a non-admin. Anything else (offline, a
      // 500) is unknown rather than "no", but the safe render is the same:
      // don't offer a page the caller may not be able to open.
      if (!(e instanceof ApiError && e.status === 404)) pending = null
      return false
    })
  return pending
}

/** False until known, so nothing admin-only flashes in for a non-admin. */
export function useIsAdmin(): boolean {
  const { user, isGuest } = useAuth()
  const [admin, setAdmin] = useState(false)
  // Guests have no account to be an admin with, and a signed-out visitor would
  // just be asking for a 404 on every landing-page load.
  const signedIn = user != null && !isGuest

  useEffect(() => {
    if (!signedIn) return
    let live = true
    void probe().then((yes) => {
      if (live) setAdmin(yes)
    })
    return () => {
      live = false
    }
  }, [signedIn])

  // Derived, not stored: signing out has to revoke this immediately, and
  // clearing it through an effect would both lag a render and mean setting
  // state synchronously on every signed-out mount.
  return signedIn && admin
}
