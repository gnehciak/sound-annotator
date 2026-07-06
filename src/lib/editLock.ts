// The edit lock: one session edits a project at a time, Google-Docs-adjacent.
//
// The lock is a `lock` value on the project row — { sessionId, uid, name, at }
// — where `at` is a server-stamped heartbeat (epoch ms). A session holds the
// lock by refreshing `at` (heartbeats + every save); a lock whose heartbeat is
// older than LOCK_TTL_MS is stale and free to claim. The API enforces the
// hard half (content writes must carry the holder's claim — see
// api/projects/[id]/index.ts); this hook does the soft half: claim,
// heartbeat, release, and telling the UI to go read-only when somebody else
// is editing.
//
// Postgres has no push channel to the browser, so live lock state is a poll
// (POLL_MS): each tick fetches the project with its lock and re-runs the same
// state machine. A closed tab holds its lock
// until the TTL lapses (~45s of "ghost lock"), which the "Take over" button
// papers over. Lock-only writes are last-write-wins by design — a take-over
// simply claims, and the loser's next poll flips its UI to read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, lastToken } from './api'
import { toProject } from './projectStore'
import type { AppUser } from './auth'
import type { Project } from '../types'

/** This tab's identity. Per-tab (not per-user) on purpose: the same account in
 *  two tabs is exactly the clobbering scenario the lock exists to prevent. */
export const SESSION_ID: string = crypto.randomUUID()

/** The claim a save carries to prove it holds the lock (the API stamps the
 *  `at` heartbeat server-side). */
export interface EditLockClaim {
  sessionId: string
  uid: string
  name: string
}

/**
 * - `off`     — no lock in play (not enabled, or the row doesn't exist yet);
 *               editing is allowed.
 * - `mine`    — this session holds the lock.
 * - `other`   — another live session holds it: go read-only.
 * - `revoked` — the owner turned link editing off mid-session: go read-only.
 */
export type EditLockState = 'off' | 'mine' | 'other' | 'revoked'

export interface EditLock {
  state: EditLockState
  /** Who holds the lock while `state === 'other'`. */
  holder: { uid: string; name: string } | null
  /** Forcibly claim the lock (the "Take over" button). */
  takeOver: () => void
  /** This session's claim, for saveProject — null when signed out. */
  claim: EditLockClaim | null
}

interface LockData {
  sessionId?: string
  uid?: string
  name?: string
  /** epoch ms, stamped by the server */
  at?: number
}

// Client-side staleness; the API treats a lock as live for 40s, so a stale
// claim here is never one the server still defends.
export const LOCK_TTL_MS = 45_000
const HEARTBEAT_MS = 15_000
// Poll cadence. Locked-out sessions see the editor's saves at this latency;
// a freed lock is claimed within one tick.
const POLL_MS = 5_000

/**
 * Poll a project's edit lock and keep this session's claim alive.
 *
 * While another session holds the lock (or before our claim lands),
 * `onRemoteData` receives each polled copy of the project, so the locked-out
 * UI tracks the editor and a take-over starts from the latest content rather
 * than clobbering it.
 */
export function useEditLock(opts: {
  projectId: string | null
  user: AppUser | null
  enabled: boolean
  onRemoteData?: (p: Project) => void
}): EditLock {
  const { projectId, user, enabled } = opts
  const [state, setState] = useState<EditLockState>('off')
  const [holder, setHolder] = useState<{ uid: string; name: string } | null>(
    null,
  )

  // Mirrors read by timers/cleanup (which live outside React's data flow).
  const stateRef = useRef<EditLockState>('off')
  const onRemoteDataRef = useRef(opts.onRemoteData)
  useEffect(() => {
    onRemoteDataRef.current = opts.onRemoteData
  })
  const takeOverRef = useRef<() => void>(() => {})

  const claim = useMemo<EditLockClaim | null>(
    () =>
      user
        ? {
            sessionId: SESSION_ID,
            uid: user.uid,
            name: user.displayName ?? user.email ?? 'Someone',
          }
        : null,
    [user],
  )

  useEffect(() => {
    const setBoth = (s: EditLockState) => {
      stateRef.current = s
      setState(s)
    }
    // Disabled: nothing to do — state is 'off' initially, and the previous
    // run's cleanup resets it when the lock disengages (track closed, etc.).
    if (!enabled || !projectId || !user || !claim) return

    const me = claim
    const lockUrl = `/api/projects/${encodeURIComponent(projectId)}/lock`
    let disposed = false
    let claiming = false

    // Claim/refresh/take over are all the same write; the API allows
    // lock-only writes unconditionally (last write wins, the loser's UI
    // flips via its next poll). Failures are expected noise — a brand-new
    // project's row doesn't exist until its first save (which carries the
    // claim itself), and a lost race just means the next poll says 'other'.
    const writeLock = () => {
      if (claiming || disposed) return
      claiming = true
      api<{ lock: LockData }>(lockUrl, {
        method: 'POST',
        json: { action: 'claim', sessionId: me.sessionId, name: me.name },
      })
        .then(() => {
          // Claim landed — flip to 'mine' immediately rather than waiting a
          // poll tick (the old latency-compensated snapshot's job).
          if (!disposed) {
            setBoth('mine')
            setHolder(null)
          }
        })
        .catch(() => {})
        .finally(() => {
          claiming = false
        })
    }
    takeOverRef.current = writeLock

    const handle = (data: Record<string, unknown>) => {
      const remote = () => onRemoteDataRef.current?.(toProject(projectId, data))

      // The owner switched link editing off under us — read-only, stop
      // claiming.
      if (data.ownerId !== user.uid && data.editableByLink !== true) {
        remote()
        setBoth('revoked')
        setHolder(null)
        return
      }

      const lock = (data.lock ?? null) as LockData | null
      const at = typeof lock?.at === 'number' ? lock.at : 0
      const live = lock != null && Date.now() - at < LOCK_TTL_MS

      if (live && lock.sessionId === SESSION_ID) {
        setBoth('mine')
        setHolder(null)
      } else if (live) {
        remote()
        setBoth('other')
        setHolder({ uid: lock.uid ?? '', name: lock.name ?? 'Someone' })
        // A merely-expired lock is caught by the next poll tick (POLL_MS
        // < the TTL margin), so no dedicated stale timer is needed.
      } else {
        // Free or stale. Take the final remote copy (the previous holder's
        // last save rides in this response), then claim for this session.
        remote()
        writeLock()
      }
    }

    const poll = async () => {
      try {
        const data = await api<Record<string, unknown>>(
          `/api/projects/${encodeURIComponent(projectId)}`,
        )
        if (!disposed) handle(data)
      } catch (err) {
        if (disposed) return
        if (err instanceof ApiError && err.status === 404) return // no row yet — the first save creates it
        if (err instanceof ApiError && err.status === 403) {
          // Read permission lost (sharing turned off entirely) → read-only.
          setBoth('revoked')
          setHolder(null)
          return
        }
        // Network blips: keep the current state; the next tick retries.
      }
    }

    void poll()
    const pollTimer = window.setInterval(() => void poll(), POLL_MS)

    // Keep the claim warm. Saves also refresh it; this covers idle listening.
    // (Hidden tabs get throttled, so a backgrounded session naturally cedes
    // the lock to an active claimant — returning shows the take-over banner.)
    const hb = window.setInterval(() => {
      if (stateRef.current === 'mine') writeLock()
    }, HEARTBEAT_MS)

    // Best-effort release when the tab goes away; the TTL covers crashes.
    // Fired from pagehide, so it can't await a token — it rides the last one
    // lib/api.ts saw (keepalive lets the request outlive the page).
    const release = () => {
      if (stateRef.current !== 'mine') return
      void fetch(lockUrl, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(lastToken ? { Authorization: `Bearer ${lastToken}` } : {}),
        },
        body: JSON.stringify({ action: 'release', sessionId: me.sessionId }),
      }).catch(() => {})
    }
    window.addEventListener('pagehide', release)

    return () => {
      disposed = true
      window.clearInterval(pollTimer)
      window.clearInterval(hb)
      window.removeEventListener('pagehide', release)
      release()
      takeOverRef.current = () => {}
      setBoth('off')
      setHolder(null)
    }
  }, [enabled, projectId, user, claim])

  const takeOver = useCallback(() => takeOverRef.current(), [])

  return { state, holder, takeOver, claim }
}
