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

export interface Annotation {
  id: string
  /** seconds into the track */
  start: number
  /** optional range end in seconds (the note covers a section) */
  end?: number
  /** category tag id (see lib/tags.ts), e.g. "pitch" | "comment" */
  tag?: string
  /** custom colour override; falls back to a color derived from the id */
  color?: string
  /** TipTap HTML */
  contentHtml: string
  createdAt: number
}

export interface Project {
  id: string
  title: string
  source?: ProjectSource
  annotations: Annotation[]
  updatedAt: number
  /**
   * When true, anyone holding the project's `?view={id}` link can open it
   * read-only (no sign-in required). Off by default; toggled from the Share
   * panel. See firestore.rules — shared docs are world-readable by id.
   */
  shared?: boolean
}

/** Imperative API every player implementation exposes to the rest of the app. */
export interface PlayerHandle {
  play(): void
  pause(): void
  seekTo(seconds: number): void
  getCurrentTime(): number
}
