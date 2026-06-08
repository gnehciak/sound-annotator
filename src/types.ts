export type SourceType = 'youtube' | 'audio'

export interface ProjectSource {
  type: SourceType
  /** YouTube */
  youtubeUrl?: string
  videoId?: string
  /** Audio file */
  fileName?: string
  /** Cloud Storage download URL for the uploaded audio (used to load it back) */
  audioUrl?: string
}

/**
 * A typed content block within a note (the plugin model). Each block is
 * rendered and edited by the plugin registered for its `type`
 * (see lib/notePlugins.ts). e.g. `{ type: "text", data: { html } }` or
 * `{ type: "elements", data: { layer, fields } }`.
 */
export interface NoteBlock {
  id: string
  /** Plugin type key — see lib/notePlugins.ts (e.g. "text" | "elements"). */
  type: string
  /** Plugin-specific payload; each plugin narrows and validates this. */
  data: unknown
}

export interface Annotation {
  id: string
  /** seconds into the track */
  start: number
  /** optional range end in seconds (the note covers a section) */
  end?: number
  /**
   * Legacy single category tag (see lib/tags.ts). Superseded by `tags`; older
   * notes still carry only this. Read both via `tagsOf()` (lib/tags.ts).
   */
  tag?: string
  /** Category tags a note carries — preset ids or custom text (see lib/tags.ts). */
  tags?: string[]
  /** custom colour override; falls back to a color derived from the id */
  color?: string
  /**
   * TipTap HTML for the note's text. Legacy/primary field; mirrors the built-in
   * `text` block while the block model rolls out (see lib/noteBlocks.ts).
   */
  contentHtml: string
  /**
   * Typed content blocks (the plugin model). Optional during migration: older
   * notes carry only `contentHtml`, which lib/noteBlocks.ts normalises to a
   * single `text` block on read.
   */
  blocks?: NoteBlock[]
  /**
   * Where this note sits in the score — free text holding a bar number or a
   * rehearsal mark (e.g. "24", "bb. 12–16", "reh. B"). Shown as a chip beside
   * the note's timecode.
   */
  bar?: string
  /**
   * Manual sort position among notes that share the same `start`. Only used as
   * the same-time tiebreaker (set via the note's ▲/▼ controls); notes that have
   * never been reordered leave it unset and fall back to `createdAt` order.
   */
  order?: number
  /**
   * Marks this note as a structural section (e.g. exposition, development). In
   * the overview a square bracket frames the note's span to the left of the
   * time spine. Off by default.
   */
  structure?: boolean
  /**
   * Optional label for a structure section, shown vertically beside its bracket
   * in the overview. Only meaningful when `structure` is set.
   */
  sectionName?: string
  createdAt: number
}

export interface Project {
  id: string
  title: string
  /**
   * Uid of the account that owns this project. Set on load (toProject); absent
   * only on a freshly created, never-saved project (the creator owns it).
   * A project whose ownerId differs from the signed-in uid is "foreign" — one
   * opened through an editable share link — and gets reduced powers in the UI.
   */
  ownerId?: string
  source?: ProjectSource
  annotations: Annotation[]
  updatedAt: number
  /**
   * When true, anyone holding the project's `?view={id}` link can open it
   * read-only (no sign-in required). Off by default; toggled from the Share
   * panel. See firestore.rules — shared docs are world-readable by id.
   */
  shared?: boolean
  /**
   * When true, anyone holding the link can also *edit* the project's notes and
   * title after signing in — one session at a time, serialized by the edit
   * lock (see lib/editLock.ts and firestore.rules). The Share panel's
   * "Can edit" role. Only the owner can flip this.
   */
  editableByLink?: boolean
  /**
   * Id of the home-page folder this track lives in, or null/absent for the
   * root library ("unfiled"). Folders live in their own `folders` collection
   * (see lib/folderStore.ts); an id pointing at a deleted folder is treated
   * as unfiled.
   */
  folderId?: string | null
  /**
   * Per-project presentation preferences set by the project owner — the
   * Settings modal's knobs. Travels with the project so a shared track
   * opens the same way for everyone. Absent on legacy projects; readers
   * substitute the user's local pref or a hard default.
   */
  settings?: ProjectSettings
}

export interface ProjectSettings {
  /** When on, the per-note Play chip arms passage playback (pause at end). */
  playOnce?: boolean
  /** Whether the overview timeline strip opens by default. */
  overviewOpen?: boolean
  /** Default ordering for the notes list. See AnnotationList for the modes. */
  noteOrder?: 'timeline' | 'auto' | 'live'
}

/** A home-page folder grouping tracks. Flat (no nesting), never shared. */
export interface Folder {
  id: string
  name: string
  createdAt: number
}

/** Imperative API every player implementation exposes to the rest of the app. */
export interface PlayerHandle {
  play(): void
  pause(): void
  seekTo(seconds: number): void
  getCurrentTime(): number
}
