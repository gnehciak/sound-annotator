// One place to ask a source what it is. Two of the three kinds are videos
// (YouTube and Google Drive) and behave identically everywhere outside their
// own player — same 16:9 frame, same clip window, a poster thumbnail on the
// tile, an "open the original" link. Spreading `type === 'youtube' ||
// type === 'drive'` across a dozen files is how the third video kind gets
// half-added, so the questions live here instead.
import type { ProjectSource } from '../types'
import { driveThumbUrl, driveViewUrl, parseDriveFileId } from './drive'
import { parseVideoId } from './youtube'

/** What a pasted video link turned out to be. */
export type ParsedVideoLink =
  | { kind: 'youtube'; id: string }
  | { kind: 'drive'; id: string }

/**
 * Read a pasted link as one of the two video kinds. Drive is checked first and
 * by host, so a Drive URL never falls through to YouTube's parser (a Drive
 * file id can carry an 11-char run that would read as a video id).
 */
export function parseVideoLink(input: string): ParsedVideoLink | null {
  const fileId = parseDriveFileId(input)
  if (fileId) return { kind: 'drive', id: fileId }
  const videoId = parseVideoId(input)
  return videoId ? { kind: 'youtube', id: videoId } : null
}

/** The source a parsed link becomes, with its clip window folded in. */
export function sourceFromLink(
  link: ParsedVideoLink,
  url: string,
  clip?: { start?: number; end?: number },
): ProjectSource {
  const window = {
    ...(clip?.start ? { clipStart: clip.start } : {}),
    ...(clip?.end ? { clipEnd: clip.end } : {}),
  }
  return link.kind === 'drive'
    ? { type: 'drive', driveUrl: url, driveFileId: link.id, ...window }
    : { type: 'youtube', youtubeUrl: url, videoId: link.id, ...window }
}

/** A source that loads a video player: 16:9 frame, clip window, poster art. */
export function isVideoSource(s?: ProjectSource): boolean {
  return s?.type === 'youtube' || s?.type === 'drive'
}

/** The id its player needs, or null when the source is too incomplete to load. */
export function videoIdOf(s?: ProjectSource): string | null {
  if (s?.type === 'youtube') return s.videoId ?? null
  if (s?.type === 'drive') return s.driveFileId ?? null
  return null
}

/** What the player pane's title bar calls this source. */
export function sourceLabel(s?: ProjectSource): 'YouTube' | 'Drive' | 'Audio' {
  if (s?.type === 'youtube') return 'YouTube'
  if (s?.type === 'drive') return 'Drive'
  return 'Audio'
}

/**
 * Where the source lives on the web — the "open the original" target. Prefers
 * the URL the teacher actually pasted (it may carry a `usp=` or a playlist
 * position worth keeping) and rebuilds a canonical one from the id otherwise.
 */
export function sourceLinkUrl(s?: ProjectSource): string | null {
  if (s?.type === 'youtube') {
    return (
      s.youtubeUrl ??
      (s.videoId ? `https://www.youtube.com/watch?v=${s.videoId}` : null)
    )
  }
  if (s?.type === 'drive') {
    return s.driveUrl ?? (s.driveFileId ? driveViewUrl(s.driveFileId) : null)
  }
  return null
}

/**
 * The source's own poster image for a cover well, or null when it has none
 * (an audio track, or no source yet) and the caller should fall back to the
 * generated waveform mark. Both hosts serve these as plain images with no API
 * and no CORS; both 404/403 on a video that's gone private, which every cover
 * already treats as "fall through to WaveArt".
 */
export function sourceThumbUrl(
  s?: ProjectSource,
  width = 320,
): string | null {
  if (s?.type === 'youtube' && s.videoId)
    return `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`
  if (s?.type === 'drive' && s.driveFileId)
    return driveThumbUrl(s.driveFileId, width)
  return null
}
