// A reader's own marks on a shared score — drawn over the teacher's, kept on
// this device, never written to the track.
//
// Marks belong to the track (score.marks), which is exactly right for what the
// teacher draws and exactly wrong for a student with a `?view=` link: they
// could read the score but not so much as circle a bar on their copy of it.
// So a reader draws on a layer of their own. It lives in this browser's
// localStorage under the project's id, like a guest's track list
// (lib/guest.ts) and for the same reason — there is no account to hang it on,
// and a read-only link has no business writing to the row. That makes it a
// convenience rather than a guarantee: another browser, a cleared cache or a
// private window starts blank, and the toolbar says so.
//
// It has an undo of its own, since the app's history is for the project and a
// viewer has none; the same coalescing rule, so a held ⌥-arrow is one step.
import { useCallback, useRef, useState } from 'react'
import type { ScoreMark } from '../types'
import { sanitizeMarks } from './projectJson'

const KEY = (projectId: string) => `sound-annotator:my-marks:${projectId}`

/** How many a reader may keep — a copy of a score, not a sketchbook. */
const MAX_PERSONAL_MARKS = 500

/** Frames of undo kept, and the window in which one key's commits merge. */
const MAX_HISTORY = 50
const COALESCE_MS = 700

function load(projectId: string): ScoreMark[] {
  try {
    const raw = localStorage.getItem(KEY(projectId))
    // Read back through the import sanitizer: localStorage is only as
    // trustworthy as whatever last wrote to it.
    return raw ? (sanitizeMarks(JSON.parse(raw))?.slice(0, MAX_PERSONAL_MARKS) ?? []) : []
  } catch {
    return []
  }
}

function store(projectId: string, marks: ScoreMark[]): void {
  try {
    if (marks.length) localStorage.setItem(KEY(projectId), JSON.stringify(marks))
    else localStorage.removeItem(KEY(projectId))
  } catch {
    /* storage full or blocked (a private window): the marks live for the visit */
  }
}

export interface PersonalMarks {
  marks: ScoreMark[]
  /** Replace the layer — one undo step, or merged into the last with the same key. */
  commit: (marks: ScoreMark[], opts?: { coalesceKey?: string }) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function usePersonalMarks(projectId: string | null | undefined): PersonalMarks {
  // Keyed by project, so opening another track in the same viewer session
  // reads that track's layer rather than keeping this one's. Adjusted during
  // render, React's documented shape for state derived from a prop.
  const [state, setState] = useState(() => ({
    id: projectId ?? null,
    marks: projectId ? load(projectId) : [],
    past: [] as ScoreMark[][],
    future: [] as ScoreMark[][],
  }))
  if (state.id !== (projectId ?? null))
    setState({ id: projectId ?? null, marks: projectId ? load(projectId) : [], past: [], future: [] })
  const coalesce = useRef<{ key: string; at: number } | null>(null)

  const commit = useCallback(
    (marks: ScoreMark[], opts?: { coalesceKey?: string }) => {
      const now = Date.now()
      const c = coalesce.current
      const merge = !!opts?.coalesceKey && c?.key === opts.coalesceKey && now - c.at < COALESCE_MS
      coalesce.current = opts?.coalesceKey ? { key: opts.coalesceKey, at: now } : null
      setState((s) => {
        if (!s.id) return s
        const next = marks.slice(0, MAX_PERSONAL_MARKS)
        store(s.id, next)
        return {
          ...s,
          marks: next,
          past: merge ? s.past : [...s.past, s.marks].slice(-MAX_HISTORY),
          future: [],
        }
      })
    },
    [],
  )

  const undo = useCallback(() => {
    coalesce.current = null
    setState((s) => {
      if (!s.id || s.past.length === 0) return s
      const marks = s.past[s.past.length - 1]
      store(s.id, marks)
      return { ...s, marks, past: s.past.slice(0, -1), future: [s.marks, ...s.future] }
    })
  }, [])

  const redo = useCallback(() => {
    coalesce.current = null
    setState((s) => {
      if (!s.id || s.future.length === 0) return s
      const [marks, ...rest] = s.future
      store(s.id, marks)
      return { ...s, marks, past: [...s.past, s.marks], future: rest }
    })
  }, [])

  return {
    marks: state.marks,
    commit,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
