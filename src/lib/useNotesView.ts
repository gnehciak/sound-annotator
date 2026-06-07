import { useMemo, useState } from 'react'
import type { Annotation } from '../types'
import { tagsUsedIn, tagsOf, resolveTag, tagCountsIn } from './tags'
import { noteLabel, notePlainText } from './format'
import {
  loadNoteOrder,
  saveNoteOrder,
  loadViewNoteOrder,
  saveViewNoteOrder,
  type NoteOrder,
} from './storage'

/**
 * The notes-list view state shared by the editor (App) and the read-only
 * ShareViewer: tag filter, list ordering, and the order-coupled auto-pin /
 * auto-cue — none of which mutate notes, so both modes can own the same
 * controls. Persisted via the same storage keys, so a preference set in one
 * place carries to the other.
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
  // Auto-pin (scrolling the playing note to the top) and auto-cue (clicking a
  // note moves the playhead to it) are both coupled to the order — on for Live
  // and Auto, off for Timeline. There's no separate toggle: the one order
  // switch drives ordering, pinning, and cue-on-click together.
  const autoPin = noteOrder !== 'timeline'
  const autoSeek = noteOrder !== 'timeline'
  // Tags the notes list is filtered to (empty = show all).
  const [tagFilter, setTagFilter] = useState<Set<string>>(() => new Set())
  // Free-text search query (empty = show all). Composes with the tag filter.
  const [search, setSearch] = useState('')

  function changeNoteOrder(mode: NoteOrder) {
    if (viewOnly) {
      saveViewNoteOrder(mode)
      setViewOrder(mode)
    } else {
      saveNoteOrder(mode)
      setEditOrder(mode)
    }
  }
  // Every tag in use across these notes — the filter's menu.
  const filterTags = useMemo(() => tagsUsedIn(annotations), [annotations])
  // How many notes carry each tag — the tally beside each filter entry.
  const filterTagCounts = useMemo(() => tagCountsIn(annotations), [annotations])
  // The selection narrowed to tags still in use: a tag whose last note was
  // retagged or deleted silently drops out, so the filter never gets stuck
  // hiding everything by a ghost tag. Derived (not stored) to stay in sync.
  const activeFilter = useMemo(() => {
    if (tagFilter.size === 0) return tagFilter
    const avail = new Set(filterTags)
    const next = new Set([...tagFilter].filter((t) => avail.has(t)))
    return next.size === tagFilter.size ? tagFilter : next
  }, [tagFilter, filterTags])
  // A lowercased search haystack per note — timecode label + full text + tag
  // labels + section name + bar/rehearsal mark. Parses HTML, so memoised on
  // the notes (not per keystroke); the query just scans these strings.
  const searchIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of annotations) {
      const tags = tagsOf(a).map((t) => resolveTag(t)?.label ?? t)
      m.set(
        a.id,
        [
          noteLabel(a.start, a.end),
          notePlainText(a.contentHtml),
          a.sectionName ?? '',
          a.bar ?? '',
          ...tags,
        ]
          .join('   ')
          .toLowerCase(),
      )
    }
    return m
  }, [annotations])

  // Query split into terms; every term must match somewhere (AND).
  const searchTerms = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? q.split(/\s+/) : []
  }, [search])

  // Whether anything is narrowing the list (tags and/or search) — drives the
  // count readout and the "no matches" empty state.
  const isFiltered = activeFilter.size > 0 || searchTerms.length > 0

  // Notes shown in the list: narrowed to the selected tags (any-of) and then to
  // the search terms (all-of). Either filter empty means it doesn't narrow.
  const visibleAnnotations = useMemo(() => {
    if (!isFiltered) return annotations
    return annotations.filter((a) => {
      if (activeFilter.size > 0 && !tagsOf(a).some((t) => activeFilter.has(t))) return false
      if (searchTerms.length > 0) {
        const hay = searchIndex.get(a.id) ?? ''
        if (!searchTerms.every((t) => hay.includes(t))) return false
      }
      return true
    })
  }, [annotations, activeFilter, searchTerms, searchIndex, isFiltered])

  return {
    noteOrder,
    changeNoteOrder,
    autoPin,
    autoSeek,
    setTagFilter,
    filterTags,
    filterTagCounts,
    activeFilter,
    search,
    setSearch,
    isFiltered,
    visibleAnnotations,
  }
}
