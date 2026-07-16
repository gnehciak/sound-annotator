// Clerk-backed auth, exposed through the same AuthState shape the app has
// always consumed. Components never touch Clerk types: they see AppUser
// ({ uid, displayName, email }), so the rest of the codebase is agnostic to
// the provider underneath.
//
// There is no context of our own anymore — useAuth() reads Clerk's hooks
// directly, so it works anywhere under <ClerkProvider> (including the share
// viewer, which renders outside <AuthProvider>). AuthProvider survives as a
// pass-through so main.tsx keeps its familiar shape.
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  useAuth as useClerkAuth,
  useUser,
  useClerk,
  useSignIn,
} from '@clerk/clerk-react'
import { registerTokenGetter } from './api'
import { guestSnapshot, leaveGuest, subscribeGuest } from './guest'

export interface AppUser {
  uid: string
  displayName: string | null
  email: string | null
  photoURL: string | null
}

interface AuthState {
  user: AppUser | null
  /** true when `user` is a signed-out guest, not a Clerk account. The app
   *  hides everything an account owns — uploads, folders, publishing. */
  isGuest: boolean
  /** true until the first auth state resolves */
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

export function AuthProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/**
 * Registers the Clerk session-token getter with lib/api.ts. Mounted once,
 * directly under <ClerkProvider> (see main.tsx), so API calls carry auth in
 * every corner of the app — the share viewer's "Make a copy" included.
 */
export function ApiTokenBridge() {
  const { getToken, isLoaded } = useClerkAuth()
  useEffect(() => {
    if (!isLoaded) return
    registerTokenGetter(() => getToken())
    return () => registerTokenGetter(null)
  }, [isLoaded, getToken])
  return <></>
}

export function useAuth(): AuthState {
  const { user: clerkUser, isLoaded } = useUser()
  const clerk = useClerk()
  const { signIn } = useSignIn()
  const guest = useSyncExternalStore(subscribeGuest, guestSnapshot, guestSnapshot)

  // Stable identity per signed-in user: effects across the app (the edit
  // lock especially) depend on `user`, and a fresh object every render would
  // re-run them all.
  const uid = clerkUser?.id ?? null
  const displayName = clerkUser?.fullName ?? clerkUser?.username ?? null
  const email = clerkUser?.primaryEmailAddress?.emailAddress ?? null
  const photoURL = clerkUser?.imageUrl ?? null
  // A guest stands in as a user whose uid is the project's synthetic owner, so
  // every `ownerId === user.uid` check downstream keeps working untouched. A
  // real Clerk session always wins: signing in mid-session must not leave the
  // app acting as the guest.
  const user = useMemo<AppUser | null>(() => {
    if (uid) return { uid, displayName, email, photoURL }
    if (guest)
      return { uid: guest.ownerId, displayName: 'Guest', email: null, photoURL: null }
    return null
  }, [uid, displayName, email, photoURL, guest])

  return {
    user,
    isGuest: !uid && guest != null,
    loading: !isLoaded,
    signInWithGoogle: async () => {
      if (!signIn) throw new Error('Auth is still loading — try again.')
      // Full-page redirect through Google; Clerk returns via /sso-callback
      // (see main.tsx) and then back to exactly where the user started.
      await signIn.authenticateWithRedirect({
        strategy: 'oauth_google',
        redirectUrl: '/sso-callback',
        redirectUrlComplete:
          window.location.pathname + window.location.search,
      })
    },
    signOut: async () => {
      // A guest has no Clerk session to end — dropping the key is the whole
      // sign-out. The work survives; only this browser's shortcut back to it
      // is gone, which is why the UI warns before doing it.
      if (!uid && guest) {
        leaveGuest()
        window.location.assign('/')
        return
      }
      await clerk.signOut()
    },
  }
}
