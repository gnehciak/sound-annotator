// NOTE — JSON import/export contract: a track's persisted *content* (title,
// source, annotations, settings) round-trips through the portable JSON file in
// lib/projectJson.ts, and is described for the outside world in
// public/track-schema.md. When you add or change a persisted field on Project,
// ProjectSource, Annotation, or ProjectSettings, update projectJson.ts *and*
// that doc — scripts/check-schema-doc.mjs fails `npm run build` otherwise:
// the export envelope carries content fields only (never account/sharing
// state), and the import sanitizer must explicitly accept the new field or an
// imported file silently loses it. Primitive-valued ProjectSettings keys pass
// through automatically; everything else needs a line in the sanitizer.

export type SourceType = 'youtube' | 'drive' | 'audio'

export interface ProjectSource {
  type: SourceType
  /** YouTube */
  youtubeUrl?: string
  videoId?: string
  /**
   * Google Drive — the file id, plus the link it was pasted from (kept whole
   * so "open the original" reaches the same page the teacher shared). The file
   * has to be link-shared to play; see lib/drive.ts for why a Drive video is
   * its own source kind rather than an `audio` one with a rewritten URL.
   */
  driveFileId?: string
  driveUrl?: string
  /**
   * Clip window into the source video, in seconds of that video. When set, the
   * track *is* the excerpt: the player opens at `clipStart`, stops at
   * `clipEnd`, and the rest of the app sees an ordinary 0-based track
   * `clipEnd - clipStart` long — note times are clip-relative, and the video
   * players are the only places that map them back to video time. Absent
   * means the whole video (`clipStart` 0, `clipEnd` the real duration).
   * Retuning the window later shifts the notes with it (see App's setClip) so
   * they stay on the same music. Video sources only (YouTube and Drive) — an
   * audio track's clip would have to fight wavesurfer's own waveform extent.
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

/**
 * What a note draws on top of the video while it's on screen — the note's
 * "stage layer". Two independent pieces, either or both:
 *
 *  - a **cover**: a full-frame image that stands in for the picture (a score
 *    excerpt, a diagram, a photo) while the audio keeps playing underneath;
 *  - a **pin**: a dot placed somewhere on the frame, captioned with the note's
 *    own text — a callout pointing at what's happening there.
 *
 * Both ride the note's moment: they appear over the note's span
 * (`start`→`end`), or for `hold` seconds from `start` when the note is a
 * single point. They also appear whenever the note is open in the inspector,
 * so you can compose one without scrubbing to its time.
 *
 * Video sources only (YouTube and Drive). An audio track's waveform *is* the
 * picture and must stay uncovered, so nothing here is offered there — the same
 * line `clipStart`/`clipEnd` draw (see ProjectSource).
 */
export interface NoteOverlay {
  /**
   * Public Blob URL of the cover image, under the project's ordinary note-image
   * prefix (`users/{uid}/images/{projectId}/…`) — it *is* a note image, just
   * one referenced from here rather than from the note's HTML. Anything that
   * sweeps or copies note images must therefore read this field too: see
   * `coverUrls()` in lib/overlays.ts and its callers (the image GC in App,
   * lib/copyProject.ts).
   */
  coverUrl?: string
  /**
   * How the cover meets the 16:9 frame: 'contain' (the default) shows the whole
   * image letterboxed, 'cover' fills the frame and crops the overflow.
   */
  coverFit?: 'contain' | 'cover'
  /**
   * Which part of a filled cover survives the crop, as 0–1 fractions (CSS
   * `object-position`): 0 keeps the left/top edge, 1 the right/bottom, and the
   * absent default is 0.5 — dead centre, which is where a crop lands if nobody
   * says otherwise. Only meaningful with `coverFit: 'cover'`; a contained image
   * has no overflow to choose from. Set by dragging the cover itself.
   */
  coverX?: number
  coverY?: number
  /**
   * Pin position as fractions of the frame, 0–1 from the top-left. Both are
   * set together or not at all — their absence is what "this note has no pin"
   * means. Fractions rather than pixels so a pin holds its spot on the picture
   * at every player size.
   */
  pinX?: number
  pinY?: number
  /**
   * Seconds the layer stays up for a note with no `end`. Ignored on a note that
   * has a span — that span is the window. Defaults to OVERLAY_HOLD.
   */
  hold?: number
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
  /**
   * What this note puts on top of the video — a cover image, a positioned pin,
   * or both. Absent on notes that stay in the list. See NoteOverlay.
   */
  overlay?: NoteOverlay
  createdAt: number
}

export interface Project {
  id: string
  /**
   * The short public id links are built from — see `publicId()` in lib/ids.ts.
   * Server-assigned and read-only: it exists only on projects created before
   * ids themselves were short, so that their 36-character uuid keys (which are
   * also baked into their Blob paths, and into links already handed out) never
   * have to change. Absent when `id` is already short. Never send it back.
   */
  alias?: string
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

/** How a score sits over the picture. */
export type ScoreMode = 'off' | 'score' | 'overlay'

/** Fit a page by its height (whole page, letterboxed) or its width (fills the
 *  frame, scrolls). */
export type ScoreFit = 'height' | 'width'

/**
 * One page turn: at clip time `t`, the score shows page `page`.
 *
 * A list of these, not one time per page, because music repeats. A da capo, a
 * repeated exposition or a second verse brings the same page back at a later
 * moment, which a page→time map cannot express and a sorted list of turns
 * can. The page shown at any moment is the last turn at or before it (see
 * `pageAt` in lib/score.ts), so the list also needs no entry for "still on
 * this page".
 */
export interface ScoreTurn {
  /** Clip time in seconds — the same clock notes use (0 = `clipStart`). */
  t: number
  /** 1-based page number. */
  page: number
}

/**
 * A PDF score attached to a track — the printed music the recording is of,
 * shown over the video so the notes on the page and the sound arrive together.
 *
 * Two ways in, and they are not equivalent. A `blob` score is bytes we host
 * (owner-only upload, `users/{uid}/scores/{projectId}/…`), fixed at the moment
 * it was uploaded. A `drive` score is a *link*: the teacher keeps annotating
 * the same Drive file and every reader picks the new version up, which is the
 * whole reason the Drive path exists. Its bytes cannot be fetched from Drive
 * by the browser for exactly the reasons a Drive video can't be — see
 * lib/drive.ts — so they come through the same `/api/browse?drive=` proxy.
 *
 * Lives inside `settings` rather than at the top of Project so it rides the
 * existing jsonb through the client and API field whitelists with no schema
 * or API change, the way the project `kind` does. That also means an owner
 * *and* a guest can set it (both may write `settings`), which is deliberate:
 * a guest may link a Drive score, and the upload half is gated in the UI and
 * by the upload token, not here.
 *
 * `turns` is anchored to the clip window like every note time, so App's
 * setClip shifts it alongside the notes when the window is retuned.
 */
export interface ProjectScore {
  /** Where the bytes live: a Drive file we proxy, or a PDF we host. */
  kind: 'drive' | 'blob'
  /** Drive — the file id plus the link it was pasted from, the same pair a
   *  Drive video source carries. The file must be shared "Anyone with the
   *  link": the proxy holds no Drive credentials. */
  driveFileId?: string
  driveUrl?: string
  /** Blob — the public (unguessable) URL of the uploaded PDF. */
  url?: string
  /** The uploaded file's name, for the score menu. Uploads only. */
  fileName?: string
  /** How the score shows by default — it travels with the project, so a
   *  shared track opens the way its owner left it. A reader may override it
   *  for their own session without writing anything back. */
  mode?: ScoreMode
  /** Overlay opacity, 0.2–1. Only meaningful in 'overlay' mode. */
  opacity?: number
  /** Page fit. Defaults to 'height' — the whole page, letterboxed. */
  fit?: ScoreFit
  /**
   * Whether the score paints in front of a note's cover image and pins
   * (lib/overlays.ts) rather than behind them. Off by default, which is the
   * order that reads: a note that takes over the picture is a deliberate
   * interruption of it, and a score is the steady background to the whole
   * track. Turn it on for a track whose score is the point and whose covers
   * are asides. Either way the score stays *under* the transport — nothing is
   * worth losing the play button for.
   */
  onTop?: boolean
  /**
   * When the page turns, in clip seconds, ascending. Absent or empty means the
   * reader turns the pages by hand. Written by the Sync pages panel; shifted
   * with the notes when the clip window moves.
   */
  turns?: ScoreTurn[]
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
  /**
   * The PDF score shown over the picture, when the track has one. Unlike the
   * other keys here it holds an object, so it needs an explicit branch in
   * lib/projectJson.ts's settings sanitizer (primitives pass through on their
   * own; anything else is dropped).
   */
  score?: ProjectScore
}

/**
 * One published project as listed by GET /api/browse — a deliberately light
 * card payload: cover + cue-line ticks + byline, never the note HTML.
 */
export interface BrowseItem {
  id: string
  /** Short public id for the gallery's `?view=` link — see lib/ids.ts. */
  alias?: string
  ownerId: string
  title: string
  sourceType: SourceType | null
  /** YouTube video id when the source is a YouTube video — drives the cover. */
  videoId: string | null
  /** Drive file id when the source is a Drive video — the other cover. */
  driveFileId: string | null
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
