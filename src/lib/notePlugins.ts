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
  /** Human label shown on the block's header. */
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
}

// The registry is now read-only in practice: nothing in the UI adds a block any
// more, because inline property tags say the same thing inside the sentence
// (see components/ElementsDictionary.tsx, which took the "+ Property" menu's
// place). It stays so that notes which already carry an `elements` block still
// render, still edit, and can still be removed — a plugin whose registration is
// dropped takes its data off the screen without deleting it, which is the one
// outcome worth avoiding.
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
