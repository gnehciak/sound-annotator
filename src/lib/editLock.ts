// The edit lock: one session edits a project at a time, Google-Docs-adjacent.
//
// The lock is a `lock` map on the project doc — { sessionId, uid, name, at } —
// where `at` is a server-timestamp heartbeat. A session holds the lock by
// refreshing `at` (heartbeats + every save); a lock whose heartbeat is older
// than LOCK_TTL_MS is stale and free to claim. firestore.rules enforces the
// hard half (content writes must carry the holder's claim — see holdsLock());
// this hook does the soft half: claim, heartbeat, release, and telling the UI
// to go read-only when somebody else is editing.
//
// Deliberately Firestore-only (no Realtime Database presence): a closed tab
// holds its lock until the TTL lapses (~45s of "ghost lock"), which the
// "Take over" button papers over. Lock-only writes are last-write-wins by
// design — a take-over simply claims, and the loser's live snapshot flips its
// UI to read-only.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  type DocumentSnapshot,
  type Timestamp,
} from 'firebase/firestore'
import type { User } from 'firebase/auth'
import { db } from './firebase'
import { toProject } from './projectStore'
import type { Project } from '../types'

/** This tab's identity. Per-tab (not per-user) on purpose: the same account in
 *  two tabs is exactly the clobbering scenario the lock exists to prevent. */
export const SESSION_ID: string = crypto.randomUUID()

/** The claim a save carries to prove it holds the lock (projectStore stamps
 *  the `at` heartbeat). */
export interface EditLockClaim {
  sessionId: string
  uid: string
  name: string
}

/**
 * - `off`     — no lock in play (not enabled, or the doc doesn't exist yet);
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
  at?: Timestamp
}

// Client-side staleness; firestore.rules treats a lock as live for 40s, so a
// stale claim here is never one the rules still defend.
export const LOCK_TTL_MS = 45_000
const HEARTBEAT_MS = 15_000

/**
 * Subscribe to a project's edit lock and keep this session's claim alive.
 *
 * While another session holds the lock (or before our claim lands),
 * `onRemoteData` receives each server-confirmed copy of the project, so the
 * locked-out UI tracks the editor live and a take-over starts from the latest
 * content rather than clobbering it.
 */
export function useEditLock(opts: {
  projectId: string | null
  user: User | null
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

    const ref = doc(db, 'projects', projectId)
    const me = claim
    let claiming = false
    let staleTimer: number | undefined
    let lastSnap: DocumentSnapshot | null = null

    // Claim/refresh/take over are all the same write; rules allow lock-only
    // writes unconditionally (last write wins, the loser's UI flips via its
    // snapshot). Failures are expected noise — a brand-new project's doc
    // doesn't exist until its first save (which carries the claim itself),
    // and a lost race just means the next snapshot says 'other'.
    const writeLock = () => {
      if (claiming) return
      claiming = true
      updateDoc(ref, { lock: { ...me, at: serverTimestamp() } })
        .catch(() => {})
        .finally(() => {
          claiming = false
        })
    }
    takeOverRef.current = writeLock

    const handle = (snap: DocumentSnapshot) => {
      lastSnap = snap
      window.clearTimeout(staleTimer)
      // serverTimestamps:'estimate' keeps our own pending claim "fresh" so the
      // latency-compensated snapshot flips us to 'mine' immediately.
      const data = snap.data({ serverTimestamps: 'estimate' })
      if (!data) return // doc not created yet — the first save claims it

      // Only server-confirmed data may refresh the UI: the persistent cache
      // replays stale snapshots on subscribe, and our own pending writes echo.
      const confirmed = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites
      const remote = () =>
        confirmed && onRemoteDataRef.current?.(toProject(snap.id, data))

      // The owner switched link editing off under us — read-only, stop claiming.
      if (data.ownerId !== user.uid && data.editableByLink !== true) {
        remote()
        setBoth('revoked')
        setHolder(null)
        return
      }

      const lock = (data.lock ?? null) as LockData | null
      const at = lock?.at?.toMillis() ?? 0
      const live = lock != null && Date.now() - at < LOCK_TTL_MS

      if (live && lock.sessionId === SESSION_ID) {
        setBoth('mine')
        setHolder(null)
      } else if (live) {
        remote()
        setBoth('other')
        setHolder({ uid: lock.uid ?? '', name: lock.name ?? 'Someone' })
        // No snapshot fires when a lock merely expires — re-check at its TTL.
        staleTimer = window.setTimeout(
          () => lastSnap && handle(lastSnap),
          at + LOCK_TTL_MS - Date.now() + 250,
        )
      } else {
        // Free or stale. Take the final remote copy (the previous holder's
        // last save rides in this snapshot), then claim for this session.
        remote()
        writeLock()
      }
    }

    const unsub = onSnapshot(ref, handle, (err) => {
      // Read permission lost (sharing turned off entirely) → read-only.
      console.error('Edit lock subscription failed:', err)
      setBoth('revoked')
      setHolder(null)
    })

    // Keep the claim warm. Saves also refresh it; this covers idle listening.
    // (Hidden tabs get throttled, so a backgrounded session naturally cedes
    // the lock to an active claimant — returning shows the take-over banner.)
    const hb = window.setInterval(() => {
      if (stateRef.current === 'mine') writeLock()
    }, HEARTBEAT_MS)

    // Best-effort release when the tab goes away; the TTL covers crashes.
    const release = () => {
      if (stateRef.current === 'mine')
        updateDoc(ref, { lock: null }).catch(() => {})
    }
    window.addEventListener('pagehide', release)

    return () => {
      unsub()
      window.clearInterval(hb)
      window.clearTimeout(staleTimer)
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
