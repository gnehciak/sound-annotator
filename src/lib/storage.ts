import type { Project } from '../types'

const KEY = 'sound-annotator:projects'

export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Project[]) : []
  } catch {
    return []
  }
}

export function saveProjects(projects: Project[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(projects))
  } catch (err) {
    // Most likely the 5MB quota — pasted screenshots are the usual culprit.
    console.warn('Could not persist projects (storage full?):', err)
  }
}

// Color theme preference. 'system' follows the OS (and live-updates with it);
// 'light' / 'dark' are explicit overrides that stick. Defaults to 'system'.
// The initial paint is handled by an inline boot script in index.html (no
// flash); this is the source of truth the React layer reads and writes.
export type ThemePref = 'system' | 'light' | 'dark'

const THEME_KEY = 'sound-annotator:theme'

export function loadTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

export function saveTheme(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* ignore */
  }
}

// Signal-color palette — the second theme axis (mode picks dark/light, the
// palette picks the hue family). Painted flash-free by the same boot script.
export const PALETTES = ['amber', 'cyan', 'vermilion', 'violet', 'mono'] as const
export type Palette = (typeof PALETTES)[number]

const PALETTE_KEY = 'sound-annotator:palette'

export function loadPalette(): Palette {
  try {
    const v = localStorage.getItem(PALETTE_KEY)
    return (PALETTES as readonly string[]).includes(v ?? '')
      ? (v as Palette)
      : 'amber'
  } catch {
    return 'amber'
  }
}

export function savePalette(palette: Palette): void {
  try {
    localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    /* ignore */
  }
}

// Width (px) of the notes pane in the player|notes split — a workspace
// preference shared across tracks. Notes is the fixed column; the player
// absorbs window-resize changes (and inspector-drag changes when docked).
const SPLIT_KEY = 'sound-annotator:notes-width'
export const DEFAULT_NOTES_WIDTH = 460

export function loadNotesWidth(): number {
  try {
    const n = parseInt(localStorage.getItem(SPLIT_KEY) ?? '', 10)
    return Number.isFinite(n) ? n : DEFAULT_NOTES_WIDTH
  } catch {
    return DEFAULT_NOTES_WIDTH
  }
}

export function saveNotesWidth(px: number): void {
  try {
    localStorage.setItem(SPLIT_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}

// Width (px) of the docked note inspector (3rd column) — a workspace preference.
const INSPECTOR_KEY = 'sound-annotator:inspector-width'
export const DEFAULT_INSPECTOR_WIDTH = 352 // 22rem

export function loadInspectorWidth(): number {
  try {
    const n = parseInt(localStorage.getItem(INSPECTOR_KEY) ?? '', 10)
    return Number.isFinite(n) ? n : DEFAULT_INSPECTOR_WIDTH
  } catch {
    return DEFAULT_INSPECTOR_WIDTH
  }
}

export function saveInspectorWidth(px: number): void {
  try {
    localStorage.setItem(INSPECTOR_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}

// Player volume (0–1) — a sticky workspace preference applied to whichever
// player (YouTube or audio) is loaded.
const VOLUME_KEY = 'sound-annotator:volume'
export const DEFAULT_VOLUME = 1

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

export function loadVolume(): number {
  try {
    const n = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '')
    return Number.isFinite(n) ? clamp01(n) : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function saveVolume(v: number): void {
  try {
    localStorage.setItem(VOLUME_KEY, String(clamp01(v)))
  } catch {
    /* ignore */
  }
}

// View-only (read-only) mode — a global workspace preference that hides every
// editing affordance.
const VIEW_ONLY_KEY = 'sound-annotator:view-only'

export function loadViewOnly(): boolean {
  try {
    return localStorage.getItem(VIEW_ONLY_KEY) === '1'
  } catch {
    return false
  }
}

export function saveViewOnly(on: boolean): void {
  try {
    localStorage.setItem(VIEW_ONLY_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// "Play once" mode — when on, clicking a range note's Play chip arms passage
// playback (seeks to start, pauses at end) instead of just seeking and letting
// playback continue past the note. Persists per-browser like the other view
// prefs. Point notes (no end) are unaffected.
const PLAY_ONCE_KEY = 'sound-annotator:play-once'

export function loadPlayOnce(): boolean {
  try {
    return localStorage.getItem(PLAY_ONCE_KEY) === '1'
  } catch {
    return false
  }
}

export function savePlayOnce(on: boolean): void {
  try {
    localStorage.setItem(PLAY_ONCE_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// How the notes list is ordered (see AnnotationList). One stability↔liveness
// dial, three stops:
//   'timeline' — always chronological by start time (the default; most stable)
//   'auto'     — follows the playhead while playing, settles to timeline when
//                paused
//   'live'     — always reorders around the playhead (most dynamic)
export type NoteOrder = 'timeline' | 'auto' | 'live'

const NOTE_ORDER_KEY = 'sound-annotator:note-order'
// Retired boolean preference, migrated below for anyone who set it: on (≠'0')
// meant timeline-when-paused (now 'auto'); off ('0') meant always-live ('live').
const RESET_ON_PAUSE_KEY = 'sound-annotator:reset-on-pause'

export function loadNoteOrder(): NoteOrder {
  try {
    const v = localStorage.getItem(NOTE_ORDER_KEY)
    if (v === 'timeline' || v === 'auto' || v === 'live') return v
    const legacy = localStorage.getItem(RESET_ON_PAUSE_KEY)
    if (legacy != null) return legacy === '0' ? 'live' : 'auto'
    return 'timeline'
  } catch {
    return 'timeline'
  }
}

export function saveNoteOrder(mode: NoteOrder): void {
  try {
    localStorage.setItem(NOTE_ORDER_KEY, mode)
  } catch {
    /* ignore */
  }
}

// View-only mode keeps its own ordering, separate from the editor's: it offers
// only Timeline / Live (no 'auto') and defaults to 'live' — viewers watch the
// notes track the playhead. 'auto' from an older value collapses to 'live'.
const VIEW_NOTE_ORDER_KEY = 'sound-annotator:note-order-view'

export function loadViewNoteOrder(): NoteOrder {
  try {
    const v = localStorage.getItem(VIEW_NOTE_ORDER_KEY)
    if (v === 'timeline' || v === 'live') return v
    return 'live'
  } catch {
    return 'live'
  }
}

export function saveViewNoteOrder(mode: NoteOrder): void {
  try {
    localStorage.setItem(VIEW_NOTE_ORDER_KEY, mode === 'auto' ? 'live' : mode)
  } catch {
    /* ignore */
  }
}

// Plugin window presentation — 'dock' (3rd column) or 'modal' (focused
// overlay). A workspace preference remembered across sessions. Defaults to dock.
const WINDOW_MODE_KEY = 'sound-annotator:window-mode'

export function loadWindowMode(): 'dock' | 'modal' {
  try {
    return localStorage.getItem(WINDOW_MODE_KEY) === 'modal' ? 'modal' : 'dock'
  } catch {
    return 'dock'
  }
}

export function saveWindowMode(mode: 'dock' | 'modal'): void {
  try {
    localStorage.setItem(WINDOW_MODE_KEY, mode)
  } catch {
    /* ignore */
  }
}

// Retired key: 'sound-annotator:auto-seek' — auto-cue used to be a standalone
// toggle; it now rides the note-order switch (off for Timeline, on for
// Auto/Live), so nothing reads or writes it anymore.

// Overview timeline zoom — 'fit' (whole track) or a gridline unit in seconds
// (e.g. 30 → 30-second divisions). A workspace preference remembered across
// sessions and tracks. Defaults to fit.
const OVERVIEW_ZOOM_KEY = 'sound-annotator:overview-zoom'

export type OverviewZoom = 'fit' | number

export function loadOverviewZoom(): OverviewZoom {
  try {
    const raw = localStorage.getItem(OVERVIEW_ZOOM_KEY)
    if (!raw || raw === 'fit') return 'fit'
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : 'fit'
  } catch {
    return 'fit'
  }
}

export function saveOverviewZoom(zoom: OverviewZoom): void {
  try {
    localStorage.setItem(OVERVIEW_ZOOM_KEY, zoom === 'fit' ? 'fit' : String(zoom))
  } catch {
    /* ignore */
  }
}

// Overview rail open/collapsed — collapsing it leaves just the panel header
// strip so the player gets the room. A workspace preference remembered across
// sessions; defaults to open.
const OVERVIEW_OPEN_KEY = 'sound-annotator:overview-open'

export function loadOverviewOpen(): boolean {
  try {
    return localStorage.getItem(OVERVIEW_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveOverviewOpen(open: boolean): void {
  try {
    localStorage.setItem(OVERVIEW_OPEN_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// Max height (px) of the YouTube video, set by dragging the handle under the
// transport. Trading video size for overview-rail room is the whole point: the
// overview is flex-1, so a shorter video gives it more space. A workspace
// preference; null (unset) falls back to the player's CSS default (50vh).
const PLAYER_HEIGHT_KEY = 'sound-annotator:player-height'

export function loadPlayerHeight(): number | null {
  try {
    const raw = localStorage.getItem(PLAYER_HEIGHT_KEY)
    if (raw == null) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

export function savePlayerHeight(px: number | null): void {
  try {
    if (px == null) localStorage.removeItem(PLAYER_HEIGHT_KEY)
    else localStorage.setItem(PLAYER_HEIGHT_KEY, String(Math.round(px)))
  } catch {
    /* ignore */
  }
}
