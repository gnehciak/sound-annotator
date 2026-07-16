// The guest session — a student working without an account.
//
// There is nothing to sign in to: the project's key IS the credential (see
// api/_lib/guest.ts). This module is the browser's half of that — it keeps the
// key in localStorage so closing the tab doesn't destroy the work, and reads
// it back off the URL when a student returns on another machine.
//
// The key is a real credential living in a URL, which is a deliberate trade:
// it's what buys students an accounts-free, password-free workflow. It also
// means anyone the link is forwarded to can edit, so the UI must be honest
// about what the private link is (see components/GuestLinkBar.tsx).
import { api, registerGuestKey } from './api'
import { fetchSharedProject } from './projectStore'

const STORE_KEY = 'sound-annotator:guest'

export interface GuestSession {
  projectId: string
  /** The capability key — sent as X-Guest-Key on every write. */
  key: string
  /** The project's synthetic `guest:<uuid>` owner, used as the app's uid. */
  ownerId: string
}

export function loadGuestSession(): GuestSession | null {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Partial<GuestSession>
    if (!s.projectId || !s.key || !s.ownerId) return null
    return s as GuestSession
  } catch {
    return null
  }
}

export function saveGuestSession(s: GuestSession): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s))
  } catch {
    // Private-mode / quota: the session still works for this tab, it just
    // won't survive a reload. The URL remains the real key either way.
  }
}

export function clearGuestSession(): void {
  try {
    localStorage.removeItem(STORE_KEY)
  } catch {
    /* nothing to clean up */
  }
}

/** `?track=<id>&key=<key>` — a student returning on a different machine. */
export function guestSessionFromUrl(): { projectId: string; key: string } | null {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get('track')
  const key = params.get('key')
  return projectId && key ? { projectId, key } : null
}

/** The private link a student keeps: opens their project with edit rights. */
export function guestEditUrl(s: GuestSession): string {
  const url = new URL(window.location.origin)
  url.searchParams.set('track', s.projectId)
  url.searchParams.set('key', s.key)
  return url.toString()
}

/** The link a student hands in: read-only, no key, opens the share viewer. */
export function guestHandInUrl(s: GuestSession): string {
  const url = new URL(window.location.origin)
  url.searchParams.set('view', s.projectId)
  return url.toString()
}

/**
 * Start a guest project. The server mints the key and returns it exactly once
 * — there is no second chance to read it, so it goes to localStorage before
 * this resolves.
 */
export async function createGuestProject(): Promise<GuestSession> {
  const projectId = crypto.randomUUID()
  const res = await api<{ guestKey: string; ownerId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    { method: 'PUT', json: { guest: true, title: 'Untitled track', updatedAt: Date.now() } },
  )
  const session: GuestSession = {
    projectId,
    key: res.guestKey,
    ownerId: res.ownerId,
  }
  saveGuestSession(session)
  return session
}

// ---------------------------------------------------------------------------
// The live session.
//
// Deliberately NOT auto-resumed from localStorage: a stale guest session on a
// shared classroom machine would swallow the sign-in screen, and the next
// person would silently land in a stranger's project. A session becomes active
// only via an explicit "Continue as guest" or a URL carrying the key — both of
// which are someone actually asking for it.
//
// A module-level store (not context) so it reaches every useAuth() caller,
// including components mounted outside <AuthProvider> like the share viewer.
// ---------------------------------------------------------------------------
let session: GuestSession | null = null
const listeners = new Set<() => void>()

export function subscribeGuest(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function guestSnapshot(): GuestSession | null {
  return session
}

function activate(s: GuestSession): void {
  session = s
  registerGuestKey(s.key)
  saveGuestSession(s)
  listeners.forEach((l) => l())
}

/** Resume this browser's guest project, or start a fresh one. */
export async function enterGuest(): Promise<GuestSession> {
  const s = loadGuestSession() ?? (await createGuestProject())
  activate(s)
  return s
}

/**
 * Adopt the session a `?track=…&key=…` URL carries — a student picking their
 * work back up on another machine. The owner id isn't in the URL, so it comes
 * from the project itself (guest rows are `shared`, so that read needs no
 * credential). Null when the link is dead or isn't a guest project, and the
 * caller falls through to the sign-in screen.
 */
export async function adoptGuestFromUrl(): Promise<GuestSession | null> {
  const fromUrl = guestSessionFromUrl()
  if (!fromUrl) return null
  registerGuestKey(fromUrl.key)
  const project = await fetchSharedProject(fromUrl.projectId)
  if (!project?.ownerId?.startsWith('guest:')) {
    registerGuestKey(null)
    return null
  }
  const s: GuestSession = { ...fromUrl, ownerId: project.ownerId }
  activate(s)
  return s
}

export function leaveGuest(): void {
  session = null
  registerGuestKey(null)
  clearGuestSession()
  listeners.forEach((l) => l())
}
