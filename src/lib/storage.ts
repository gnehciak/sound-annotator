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

// Width (px) of the player pane in the player|notes split — a workspace
// preference shared across tracks.
const SPLIT_KEY = 'sound-annotator:player-width'
export const DEFAULT_PLAYER_WIDTH = 510

export function loadPlayerWidth(): number {
  try {
    const n = parseInt(localStorage.getItem(SPLIT_KEY) ?? '', 10)
    return Number.isFinite(n) ? n : DEFAULT_PLAYER_WIDTH
  } catch {
    return DEFAULT_PLAYER_WIDTH
  }
}

export function savePlayerWidth(px: number): void {
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

// Track-rack (sidebar) open/closed — a workspace preference remembered across
// sessions. Defaults to open for a first visit.
const SIDEBAR_KEY = 'sound-annotator:sidebar-open'

export function loadSidebarOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveSidebarOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// Auto-pin — when on, the playing note scrolls to the top of the notes list
// (and re-pins after a scroll, and on note-click). Off keeps the list still, so
// the user scrolls it by hand. A workspace preference; defaults on.
const AUTO_PIN_KEY = 'sound-annotator:auto-pin'

export function loadAutoPin(): boolean {
  try {
    return localStorage.getItem(AUTO_PIN_KEY) !== '0'
  } catch {
    return true
  }
}

export function saveAutoPin(on: boolean): void {
  try {
    localStorage.setItem(AUTO_PIN_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

// Auto-cue on click — when on, clicking a note in the list moves the playhead
// to it (and opens it). Off leaves the playhead where it is; ⌘/Ctrl-click still
// cues on demand. A workspace preference; defaults off (clicking just edits).
const AUTO_SEEK_KEY = 'sound-annotator:auto-seek'

export function loadAutoSeek(): boolean {
  try {
    return localStorage.getItem(AUTO_SEEK_KEY) === '1'
  } catch {
    return false
  }
}

export function saveAutoSeek(on: boolean): void {
  try {
    localStorage.setItem(AUTO_SEEK_KEY, on ? '1' : '0')
  } catch {
    /* ignore */
  }
}

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
