import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { loadNotesWidth, saveNotesWidth, DEFAULT_NOTES_WIDTH } from './storage'

/**
 * The resizable player|notes split, shared by the editor (App) and the
 * read-only ShareViewer. Notes is the fixed-width column; the player is the
 * flex column, so it absorbs window-resize (and, in the editor, inspector-drag)
 * changes while the notes column keeps its width. The width is a persisted
 * workspace preference (see storage `notes-width`).
 *
 * The Tailwind variant below is full literals (no string concat) so the
 * scanner generates them. The split goes side-by-side at 660px; below the
 * breakpoint the panes stack vertically and the width rules go inert.
 */
export const NOTES_SPLIT_660 = {
  row: 'min-[660px]:flex-row',
  player: 'min-[660px]:flex-1 min-[660px]:min-w-0 min-[660px]:border-b-0',
  notes:
    'min-[660px]:flex-none min-[660px]:w-[var(--notes-w)] min-[660px]:min-w-[340px] min-[660px]:max-w-[calc(100%-360px)]',
  handle: 'min-[660px]:block',
}

export function useNotesSplit() {
  const [notesWidth, setNotesWidth] = useState(loadNotesWidth)
  const [dragging, setDragging] = useState(false)
  const splitRef = useRef<HTMLDivElement>(null)

  // `reserved` is any width occupied to the right of the notes column (the
  // docked inspector, in the editor); the notes column hugs that right edge, so
  // we measure its width from there. The player (flex) absorbs the rest.
  function startSplitDrag(e: PointerEvent, reserved = 0) {
    e.preventDefault()
    const container = splitRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    let last = notesWidth
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const move = (ev: globalThis.PointerEvent) => {
      const rightEdge = rect.right - reserved
      const max = Math.max(340, rect.width - reserved - 360)
      last = Math.min(max, Math.max(340, rightEdge - ev.clientX))
      setNotesWidth(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      setDragging(false)
      saveNotesWidth(last)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function resetSplit() {
    setNotesWidth(DEFAULT_NOTES_WIDTH)
    saveNotesWidth(DEFAULT_NOTES_WIDTH)
  }

  // Set + persist the width directly (used by the auto-fit "Fit" button). Floors
  // at the same 340px the drag does.
  function applyNotesWidth(px: number) {
    const w = Math.max(340, Math.round(px))
    setNotesWidth(w)
    saveNotesWidth(w)
  }

  // Drop onto the split container so its children can read --notes-w.
  const style = { ['--notes-w']: `${notesWidth}px` } as CSSProperties

  return {
    splitRef,
    notesWidth,
    dragging,
    startSplitDrag,
    resetSplit,
    setNotesWidth: applyNotesWidth,
    style,
  }
}
