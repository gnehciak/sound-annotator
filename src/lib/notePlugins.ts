// The plugin registry. Each note block `type` maps to one NotePlugin describing
// how to render it at rest (Summary), how to edit it (inline, or in the plugin
// window), and its default payload. Adding a feature = register a plugin + its
// components; the note row, data layer, and window shell stay untouched.
import type { ComponentType } from 'react'

/** Minimal icon contract (satisfied by every lucide-react icon). */
export type IconComponent = ComponentType<{ size?: number | string; className?: string }>

/**
 * Where a plugin's editor lives:
 *  - 'inline'  — edited in place on the note (the built-in `text` block).
 *  - 'window'  — opened in the dock/modal plugin window (e.g. `elements`).
 */
export type PluginSurface = 'inline' | 'window'

export interface PluginSummaryProps {
  data: unknown
}

export interface PluginEditorProps {
  data: unknown
  onChange: (data: unknown) => void
  /** Live playhead, so a window plugin can reference the current moment. */
  currentTime: number
  readOnly?: boolean
}

export interface NotePlugin {
  /** Stable key, stored on NoteBlock.type. */
  type: string
  /** Human label for the "+ property" menu. */
  label: string
  icon: IconComponent
  surface: PluginSurface
  /** Default payload when a block of this type is added. */
  createData: () => unknown
  /** Compact, read-only render shown on the note at rest. */
  Summary: ComponentType<PluginSummaryProps>
  /** Editor body, hosted in the plugin window (surface: 'window'). */
  Editor?: ComponentType<PluginEditorProps>
  /** One-line text digest, for spec lines / future search & export. */
  summarize?: (data: unknown) => string
  /**
   * When false, the plugin is hidden from the "+ property" menu (e.g. the
   * built-in text block, which every note already has). Defaults to true.
   */
  addable?: boolean
}

// Registration order drives the "+ property" menu order. Plugins land in later
// phases; the registry ships empty so Phase 1 changes no behavior.
const REGISTRY: NotePlugin[] = []

export function registerPlugin(plugin: NotePlugin): void {
  if (REGISTRY.some((p) => p.type === plugin.type)) return
  REGISTRY.push(plugin)
}

export function getPlugin(type: string): NotePlugin | undefined {
  return REGISTRY.find((p) => p.type === type)
}

/** All registered plugins, in registration order. */
export function allPlugins(): readonly NotePlugin[] {
  return REGISTRY
}

/** Plugins offered in the "+ property" menu (addable, window-surfaced). */
export function addablePlugins(): NotePlugin[] {
  return REGISTRY.filter((p) => p.addable !== false)
}
