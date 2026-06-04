import { useMemo, useState } from 'react'
import type { Annotation } from '../types'
import { tagsUsedIn, tagsOf } from './tags'
import {
  loadNoteOrder,
  saveNoteOrder,
  loadViewNoteOrder,
  saveViewNoteOrder,
  loadAutoPin,
  saveAutoPin,
  loadAutoSeek,
  saveAutoSeek,
  type NoteOrder,
} from './storage'

/**
 * The notes-list view state shared by the editor (App) and the read-only
 * ShareViewer: tag filter, list ordering, auto-pin and auto-cue — none of which
 * mutate notes, so both modes can own the same controls. Persisted via the same
 * storage keys, so a preference set in one place carries to the other.
 *
 * Pass the current track's annotations; `visibleAnnotations` is them narrowed to
 * the active tag filter, and `filterTags` is every tag in use (the filter menu).
 *
 * `viewOnly` selects the ordering preference: the editor's (timeline / auto /
 * live, default timeline) or the view-only one (timeline / live, default live).
 * They persist independently, so toggling view mode doesn't disturb the other.
 */
export function useNotesView(annotations: Annotation[], viewOnly = false) {
  // Two independent ordering prefs (edit vs. view-only); the active one is
  // chosen by `viewOnly`. See AnnotationList for what each value means.
  const [editOrder, setEditOrder] = useState<NoteOrder>(loadNoteOrder)
  const [viewOrder, setViewOrder] = useState<NoteOrder>(loadViewNoteOrder)
  const noteOrder = viewOnly ? viewOrder : editOrder
  // When on, the playing note auto-scrolls to the top of the notes list.
  const [autoPin, setAutoPin] = useState(loadAutoPin)
  // When on, clicking a note in the list cues the playhead to it.
  const [autoSeek, setAutoSeek] = useState(loadAutoSeek)
  // Tags the notes list is filtered to (empty = show all).
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set())

  function changeNoteOrder(mode: NoteOrder) {
    if (viewOnly) {
      saveViewNoteOrder(mode)
      setViewOrder(mode)
    } else {
      saveNoteOrder(mode)
      setEditOrder(mode)
    }
  }
  function toggleAutoPin() {
    setAutoPin((on) => {
      const next = !on
      saveAutoPin(next)
      return next
    })
  }
  function toggleAutoSeek() {
    setAutoSeek((on) => {
      const next = !on
      saveAutoSeek(next)
      return next
    })
  }

  // Every tag in use across these notes — the filter's menu.
  const filterTags = useMemo(() => tagsUsedIn(annotations), [annotations])
  // The selection narrowed to tags still in use: a tag whose last note was
  // retagged or deleted silently drops out, so the filter never gets stuck
  // hiding everything by a ghost tag. Derived (not stored) to stay in sync.
  const activeFilter = useMemo(() => {
    if (tagFilter.size === 0) return tagFilter
    const avail = new Set(filterTags)
    const next = new Set([...tagFilter].filter((t) => avail.has(t)))
    return next.size === tagFilter.size ? tagFilter : next
  }, [tagFilter, filterTags])
  // Notes shown in the list: all of them, or those carrying any selected tag.
  const visibleAnnotations = useMemo(() => {
    if (activeFilter.size === 0) return annotations
    return annotations.filter((a) => tagsOf(a).some((t) => activeFilter.has(t)))
  }, [annotations, activeFilter])

  return {
    noteOrder,
    changeNoteOrder,
    autoPin,
    toggleAutoPin,
    autoSeek,
    toggleAutoSeek,
    setTagFilter,
    filterTags,
    activeFilter,
    visibleAnnotations,
  }
}
