// First-party auth, exposed through the same AuthState shape the app has
// always consumed. Components see AppUser ({ uid, displayName, email,
// photoURL }) and know nothing about how sign-in works underneath — which is
// what made swapping Firebase for Clerk, and now Clerk for our own Google
// OAuth, a change confined to this file and its two callers.
//
// The session is an httpOnly cookie, so the client cannot read who it is: it
// asks. GET /api/auth/me answers once at boot, and the result is held in a
// module-level store rather than React state so that every useAuth() in the
// tree shares one fetch and one identity — including the share viewer, which
// renders outside <AuthProvider>.
import { useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { api } from './api'
import { guestSnapshot, leaveGuest, subscribeGuest } from './guest'

export interface AppUser {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

interface AuthState {
  user: AppUser | null
  /** true when `user` is a signed-out guest, not an account. The app hides
   *  everything an account owns — folders, publishing, the admin console. */
  isGuest: boolean
  /** true until the first auth state resolves */
  loading: boolean
  /** false when the deploy has no Google credentials set — Gate shows the
   *  setup notice instead of a sign-in button that leads nowhere. */
  configured: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

interface MeResponse {
  configured: boolean
  user: {
    uid: string
    email: string
    displayName: string | null
    photoURL: string | null
    isAdmin: boolean
  } | null
}

interface Snapshot {
  user: AppUser | null
  configured: boolean
  loading: boolean
}

// One shared snapshot for the whole tree. `useSyncExternalStore` demands a
// stable object identity between changes — a fresh one each read would spin
// forever — so this is replaced only when the answer actually changes.
let snapshot: Snapshot = { user: null, configured: true, loading: true }
const listeners = new Set<() => void>()
let inFlight: Promise<void> | null = null

function emit(next: Snapshot) {
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  // Kick the one fetch on first subscription rather than at module load, so a
  // page that never mounts auth (nothing does today, but the share viewer came
  // close) doesn't pay for it.
  void load()
  return () => {
    listeners.delete(fn)
  }
}

function read(): Snapshot {
  return snapshot
}

function load(): Promise<void> {
  inFlight ??= api<MeResponse>('/api/auth/me')
    .then((me) => {
      emit({
        configured: me.configured,
        loading: false,
        user: me.user
          ? {
              uid: me.user.uid,
              displayName: me.user.displayName,
              email: me.user.email,
              photoURL: me.user.photoURL,
            }
          : null,
      })
    })
    .catch(() => {
      // No backend reachable (UI-only `npm run dev`): signed out, and let the
      // app render rather than hanging on a spinner forever.
      emit({ user: null, configured: false, loading: false })
    })
  return inFlight
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function useAuth(): AuthState {
  const state = useSyncExternalStore(subscribe, read, read)
  const guest = useSyncExternalStore(subscribeGuest, guestSnapshot, guestSnapshot)

  // Stable identity per signed-in user: effects across the app (the edit lock
  // especially) depend on `user`, and a fresh object every render would re-run
  // them all. A real session always wins over a guest key: signing in
  // mid-session must not leave the app acting as the guest.
  const account = state.user
  const user = useMemo<AppUser | null>(() => {
    if (account) return account
    if (guest)
      return { uid: guest.ownerId, displayName: 'Guest', email: null, photoURL: null }
    return null
  }, [account, guest])

  return {
    user,
    isGuest: !account && guest != null,
    loading: state.loading,
    configured: state.configured,
    signInWithGoogle: async () => {
      // A full-page redirect, not a popup: popups are blocked often enough on
      // school-managed browsers that the flow has to survive without one. The
      // server bounces us back to exactly where we started.
      const here = window.location.pathname + window.location.search
      window.location.assign(`/api/auth/google?next=${encodeURIComponent(here)}`)
      // Resolve never — the page is navigating away, and callers await this
      // before showing their own "signing in…" state.
      await new Promise<void>(() => {})
    },
    signOut: async () => {
      // A guest has no session to end — dropping the key is the whole sign-out.
      // The work survives; only this browser's shortcut back to it is gone,
      // which is why the UI warns before doing it.
      if (!account && guest) {
        leaveGuest()
        window.location.assign('/')
        return
      }
      await api('/api/auth/signout', { method: 'POST' }).catch(() => {})
      window.location.assign('/')
    },
  }
}
