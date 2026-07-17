// NOTE — JSON import/export contract: a track's persisted *content* (title,
// source, annotations, settings) round-trips through the portable JSON file in
// lib/projectJson.ts. When you add or change a persisted field on Project,
// ProjectSource, Annotation, or ProjectSettings, update projectJson.ts too:
// the export envelope carries content fields only (never account/sharing
// state), and the import sanitizer must explicitly accept the new field or an
// imported file silently loses it. Primitive-valued ProjectSettings keys pass
// through automatically; everything else needs a line in the sanitizer.

export type SourceType = 'youtube' | 'audio'

export interface ProjectSource {
  type: SourceType
  /** YouTube */
  youtubeUrl?: string
  videoId?: string
  /**
   * Clip window into the source video, in seconds of that video. When set, the
   * track *is* the excerpt: the player opens at `clipStart`, stops at
   * `clipEnd`, and the rest of the app sees an ordinary 0-based track
   * `clipEnd - clipStart` long — note times are clip-relative, and
   * YouTubePlayer is the only place that maps them back to video time. Absent
   * means the whole video (`clipStart` 0, `clipEnd` the real duration).
   * Retuning the window later shifts the notes with it (see App's setClip) so
   * they stay on the same music. YouTube only — an audio track's clip would
   * have to fight wavesurfer's own waveform extent.
   */
  clipStart?: number
  clipEnd?: number
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
  /**
   * Plain-text lyrics for a song-structure section (whole-section granularity,
   * not line-synced), shown in the structure board's Lyrics panel. Only
   * meaningful on structure projects' sections.
   */
  lyrics?: string
  /**
   * Marks this note as a listening-task question: the note's rich text is the
   * prompt, anchored to its moment. A shared track carrying question notes
   * opens through its `?view=` link as a worksheet — students get an answer
   * box under each question (answers stay on their device, see lib/answers.ts)
   * and hand back a PDF answer sheet (lib/answerSheet.ts). Off by default.
   */
  question?: boolean
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
   * panel. The API serves shared projects to anyone by id (see
   * api/projects/[id]/index.ts).
   */
  shared?: boolean
  /**
   * When true, anyone holding the link can also *edit* the project's notes and
   * title after signing in — one session at a time, serialized by the edit
   * lock (see lib/editLock.ts and api/projects/[id]/index.ts). The Share panel's
   * "Can edit" role. Only the owner can flip this.
   */
  editableByLink?: boolean
  /**
   * When true, the project is listed on the public Browse gallery — anyone
   * can find it there and open it read-only (publishing implies viewability,
   * independent of `shared`). Off by default; toggled from the Share panel.
   * Only the owner can flip it; the server stamps the byline on publish.
   */
  published?: boolean
  /** Display name stamped by the server when the project was published. */
  publishedByName?: string
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
  /**
   * Blob URLs of the separated stems (vocals/drums/bass/guitar/piano/other),
   * saved by AI section detection (api/projects/[id]/analyze.ts). Read-only
   * client-side: the server ignores it on writes — the analyze endpoint is
   * its only writer. Present only on analyzed tracks; drives the stem mixer.
   */
  stems?: Record<string, string>
  /**
   * Epoch ms of the move to the trash; absent on a live project. A trashed
   * track keeps everything — notes, images, share and publish state — so
   * restoring it puts it back exactly as it left; after 30 days the purge cron
   * (api/cron/purge-trash.ts) deletes it for good. Trashed projects live in
   * their own App state and their own listing (`GET /api/projects?trash=1`),
   * never alongside the library.
   *
   * Server-set only: a save never carries it (the API drops it — see
   * api/projects/[id]/index.ts), and only the trash routes move a project in
   * or out. Deliberately absent from exported JSON, like the other row state —
   * see lib/projectJson.ts.
   */
  deletedAt?: number
}

export interface ProjectSettings {
  /**
   * What kind of editor this project opens in. Absent (the default) is a
   * classic annotation track; 'structure' opens the song-structure board — a
   * visual section timeline whose annotations are the sections (see
   * lib/sections.ts). Set once at creation. It lives here (not at the Project
   * top level) so it rides the existing `settings` jsonb through the client
   * and API field whitelists with no schema or API change.
   */
  kind?: 'structure'
  /** When on, the per-note Play chip arms passage playback (pause at end). */
  playOnce?: boolean
  /** Whether the overview timeline strip opens by default. */
  overviewOpen?: boolean
  /** Default ordering for the notes list. See AnnotationList for the modes. */
  noteOrder?: 'timeline' | 'auto' | 'live'
}

/**
 * One published project as listed by GET /api/browse — a deliberately light
 * card payload: cover + cue-line ticks + byline, never the note HTML.
 */
export interface BrowseItem {
  id: string
  ownerId: string
  title: string
  sourceType: SourceType | null
  /** YouTube video id when the source is a video — drives the card cover. */
  videoId: string | null
  noteCount: number
  /** Note positions/colours for the cue line (capped server-side). */
  ticks: { id: string; start: number; end?: number; color?: string }[]
  publishedByName: string
  publishedAt: number
  updatedAt: number
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
