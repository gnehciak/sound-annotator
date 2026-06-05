import { useCallback, useRef, useState } from 'react'
import type { Project } from '../types'

// How many undo frames to keep. Frames hold *references* to the immutable
// Project objects (every mutation spreads new ones), so unchanged projects and
// notes are shared across frames — memory cost is small.
const MAX_HISTORY = 50
// Rapid commits sharing a coalesceKey within this window merge into one undo
// step (a region drag, a run of ±1s nudges, typing into the title).
const COALESCE_MS = 700

type Updater<T> = T | ((prev: T) => T)

const applyUpdater = <T,>(u: Updater<T>, prev: T): T =>
  typeof u === 'function' ? (u as (p: T) => T)(prev) : u

/** A point-in-time snapshot: the project data plus which track was open. */
interface Frame {
  projects: Project[]
  currentId: string | null
}

export interface ProjectHistory {
  projects: Project[]
  currentId: string | null
  /** Raw, non-undoable: hydration, text-body edits, project lifecycle, selection. */
  setProjects: (u: Updater<Project[]>) => void
  setCurrentId: (u: Updater<string | null>) => void
  /** Undoable: snapshots the present, then applies `u`. */
  commit: (u: Updater<Project[]>, opts?: { coalesceKey?: string }) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Bumps on every undo/redo — used to remount the live editor so it re-reads
   *  restored content (see App's inspector key). */
  epoch: number
  /** Re-baseline to a freshly loaded set and clear both stacks. */
  reset: (projects: Project[], currentId: string | null) => void
}

/**
 * Owns the project list and the open-track id behind an undo/redo history.
 * `commit` is the undoable mutation primitive; the raw setters bypass history.
 * The present is mirrored in refs that the setters keep in sync, so commit/undo
 * read the latest values synchronously (independent of React's async state).
 */
export function useProjectHistory(): ProjectHistory {
  const [projects, setProjectsState] = useState<Project[]>([])
  const [currentId, setCurrentIdState] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  const [flags, setFlags] = useState({ canUndo: false, canRedo: false })

  const past = useRef<Frame[]>([])
  const future = useRef<Frame[]>([])
  const coalesce = useRef<{ key: string; at: number } | null>(null)
  // Mirrors of the present state, written only by the setters below (never read
  // during render), so the mutators always see the latest committed values.
  const projectsRef = useRef<Project[]>([])
  const currentIdRef = useRef<string | null>(null)

  // Recompute the disabled state of the buttons from the live stacks. Called
  // from the mutators (event handlers), so it never reads refs during render.
  const syncFlags = useCallback(() => {
    const canUndo = past.current.length > 0
    const canRedo = future.current.length > 0
    setFlags((f) =>
      f.canUndo === canUndo && f.canRedo === canRedo
        ? f
        : { canUndo, canRedo },
    )
  }, [])

  const setProjects = useCallback((u: Updater<Project[]>) => {
    const next = applyUpdater(u, projectsRef.current)
    projectsRef.current = next
    setProjectsState(next)
  }, [])

  const setCurrentId = useCallback((u: Updater<string | null>) => {
    const next = applyUpdater(u, currentIdRef.current)
    currentIdRef.current = next
    setCurrentIdState(next)
  }, [])

  const commit = useCallback(
    (u: Updater<Project[]>, opts?: { coalesceKey?: string }) => {
      const prev = projectsRef.current
      const next = applyUpdater(u, prev)
      if (next === prev) return

      const key = opts?.coalesceKey ?? null
      const at = Date.now()
      const merge =
        key != null &&
        coalesce.current != null &&
        coalesce.current.key === key &&
        at - coalesce.current.at < COALESCE_MS &&
        past.current.length > 0

      if (!merge) {
        past.current.push({ projects: prev, currentId: currentIdRef.current })
        if (past.current.length > MAX_HISTORY) past.current.shift()
      }
      future.current = []
      coalesce.current = key != null ? { key, at } : null

      projectsRef.current = next
      setProjectsState(next)
      syncFlags()
    },
    [syncFlags],
  )

  const undo = useCallback(() => {
    if (past.current.length === 0) return
    const frame = past.current.pop()!
    future.current.push({
      projects: projectsRef.current,
      currentId: currentIdRef.current,
    })
    coalesce.current = null
    projectsRef.current = frame.projects
    currentIdRef.current = frame.currentId
    setProjectsState(frame.projects)
    setCurrentIdState(frame.currentId)
    setEpoch((e) => e + 1)
    syncFlags()
  }, [syncFlags])

  const redo = useCallback(() => {
    if (future.current.length === 0) return
    const frame = future.current.pop()!
    past.current.push({
      projects: projectsRef.current,
      currentId: currentIdRef.current,
    })
    coalesce.current = null
    projectsRef.current = frame.projects
    currentIdRef.current = frame.currentId
    setProjectsState(frame.projects)
    setCurrentIdState(frame.currentId)
    setEpoch((e) => e + 1)
    syncFlags()
  }, [syncFlags])

  const reset = useCallback(
    (ps: Project[], id: string | null) => {
      past.current = []
      future.current = []
      coalesce.current = null
      projectsRef.current = ps
      currentIdRef.current = id
      setProjectsState(ps)
      setCurrentIdState(id)
      syncFlags()
    },
    [syncFlags],
  )

  return {
    projects,
    currentId,
    setProjects,
    setCurrentId,
    commit,
    undo,
    redo,
    canUndo: flags.canUndo,
    canRedo: flags.canRedo,
    epoch,
    reset,
  }
}
