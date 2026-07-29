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
import type { ProjectSource } from '../types'
import { api, registerGuestKey } from './api'
import { fetchSharedProject } from './projectStore'
import { isStructureProject } from './sections'

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

// ---------------------------------------------------------------------------
// The device's guest tracks.
//
// A guest's key exists in exactly one place — the URL — and the live session
// above holds only the newest one. Starting a second track would therefore
// overwrite the only pointer to the first, quietly stranding work nobody can
// reach again. So every track this browser mints (or adopts off a link) is
// also appended here, and the landing page lists them: not a library (the
// server has no way to enumerate a guest's projects) but the honest local
// record of "what you started on this machine".
//
// It is still only localStorage — a wiped school profile takes it — which is
// exactly why the private link stays the thing students are told to keep.
// ---------------------------------------------------------------------------

const HISTORY_KEY = 'sound-annotator:guest-tracks'
/** Keep the strip short; older entries fall off rather than growing forever. */
const HISTORY_MAX = 8

export interface GuestTrackRef {
  projectId: string
  key: string
  /** Title at the moment it was started — never refreshed, so it can go stale. */
  title: string
  /** Which surface it opens as, so the chip can say so (absent = notes). */
  kind?: 'structure'
  /** When this device first saw it. Orders the list, newest first. */
  at: number
}

export function guestHistory(): GuestTrackRef[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    return list.filter(
      (e): e is GuestTrackRef =>
        !!e &&
        typeof (e as GuestTrackRef).projectId === 'string' &&
        typeof (e as GuestTrackRef).key === 'string',
    )
  } catch {
    return []
  }
}

/** Record a track this device holds the key to (newest first, de-duped by id). */
function rememberGuestTrack(ref: GuestTrackRef): void {
  try {
    const next = [ref, ...guestHistory().filter((e) => e.projectId !== ref.projectId)]
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, HISTORY_MAX)))
  } catch {
    /* private mode / quota — the URL is still the real key */
  }
}

/** Drop one track from the device's list (it stays on the server). */
export function forgetGuestTrack(projectId: string): void {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(guestHistory().filter((e) => e.projectId !== projectId)),
    )
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

/** The private link for any track this device holds a key to. */
export function guestTrackUrl(ref: { projectId: string; key: string }): string {
  const url = new URL(window.location.origin)
  url.searchParams.set('track', ref.projectId)
  url.searchParams.set('key', ref.key)
  return url.toString()
}

/** The private link a student keeps: opens their project with edit rights. */
export function guestEditUrl(s: GuestSession): string {
  return guestTrackUrl(s)
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
 *
 * `init` lets the caller land the project already loaded: the landing page
 * pastes a YouTube link, so the source (and the video's real title) are known
 * before the row exists, and the student arrives at a player rather than at
 * another form. `kind: 'structure'` is the same settings flag App's own
 * createProject writes for a song-section board. A guest may write both their
 * source and their settings — see the API's PUT — so these are the same rights
 * they'd have a second later inside the editor.
 */
export async function createGuestProject(init?: {
  title?: string
  source?: ProjectSource
  kind?: 'structure'
}): Promise<GuestSession> {
  const projectId = crypto.randomUUID()
  const title = init?.title?.trim() || 'Untitled track'
  const res = await api<{ guestKey: string; ownerId: string }>(
    `/api/projects/${encodeURIComponent(projectId)}`,
    {
      method: 'PUT',
      json: {
        guest: true,
        title,
        ...(init?.source ? { source: init.source } : {}),
        ...(init?.kind === 'structure' ? { settings: { kind: init.kind } } : {}),
        updatedAt: Date.now(),
      },
    },
  )
  const session: GuestSession = {
    projectId,
    key: res.guestKey,
    ownerId: res.ownerId,
  }
  saveGuestSession(session)
  rememberGuestTrack({
    projectId,
    key: session.key,
    title,
    kind: init?.kind,
    at: Date.now(),
  })
  return session
}

// ---------------------------------------------------------------------------
// The live session.
//
// Deliberately NOT auto-resumed from localStorage: a stale guest session on a
// shared classroom machine would swallow the sign-in screen, and the next
// person would silently land in a stranger's project. A session becomes active
// only via an explicit start on the landing page or a URL carrying the key —
// both of which are someone actually asking for it.
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

/**
 * Start a *new* guest track and make it the live session — the landing page's
 * paste field and its "start without a link" fallback.
 *
 * Deliberately never resumes: the caller has just told us which video they
 * want, and silently reopening last week's track instead would be a lie. Going
 * back to an earlier track is its own explicit act, off `guestHistory()`.
 */
export async function startGuestTrack(init?: {
  title?: string
  source?: ProjectSource
  kind?: 'structure'
}): Promise<GuestSession> {
  const s = await createGuestProject(init)
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
  // The link worked, so this machine now holds a key it didn't mint — record
  // it, or the landing page would claim the student has no tracks here.
  rememberGuestTrack({
    projectId: s.projectId,
    key: s.key,
    title: project.title || 'Untitled track',
    kind: isStructureProject(project) ? 'structure' : undefined,
    at: Date.now(),
  })
  return s
}

export function leaveGuest(): void {
  session = null
  registerGuestKey(null)
  clearGuestSession()
  listeners.forEach((l) => l())
}
