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
