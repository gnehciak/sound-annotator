// "Download the video and play the downloaded copy." The client half of
// api/projects/[id]/video.ts, and only ever meaningful for a YouTube source —
// a Drive video and an audio URL already stream straight into a media element.
//
// The server downloads the whole video+audio once (the reader's browser can't
// reach past YouTube's bot wall from here any more than it can for the clip
// export), merges it to an mp4 and keeps it in Blob, shared by every project of
// the same video. Afterwards a plain `<video>` plays it back through a Range
// proxy at the same route — see localVideoUrl / LocalVideoPlayer.
import { useCallback, useEffect, useRef, useState } from 'react'

/** The playback proxy for a project's downloaded copy (GET, Range-aware) —
 *  our own origin, like the Drive video proxy and the clip export. */
export function localVideoUrl(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/video`
}

/** The download quality: a max height, or "best" for whatever YouTube offers. */
export type VideoQuality = 360 | 480 | 720 | 1080 | 'best'
export const VIDEO_QUALITIES: { value: VideoQuality; label: string }[] = [
  { value: 'best', label: 'Best available' },
  { value: 1080, label: '1080p' },
  { value: 720, label: '720p' },
  { value: 480, label: '480p' },
  { value: 360, label: '360p' },
]
export const DEFAULT_QUALITY: VideoQuality = 720

export interface VideoProbe {
  available: boolean
  size?: number
}

/** Is a downloaded copy already stored? Cheap (one Blob list on the server). */
export async function probeLocalVideo(projectId: string): Promise<VideoProbe> {
  const res = await fetch(`${localVideoUrl(projectId)}?probe=1`)
  if (!res.ok) return { available: false }
  return (await res.json().catch(() => ({ available: false }))) as VideoProbe
}

export interface DownloadProgress {
  stage: 'download' | 'merge' | 'save'
  percent?: number
}

/** A short status line for a download in flight. */
export function downloadLabel(p: DownloadProgress | null): string {
  if (!p) return 'Starting…'
  if (p.stage === 'merge') return 'Merging…'
  if (p.stage === 'save') return 'Saving…'
  return p.percent != null ? `Downloading ${Math.round(p.percent)}%` : 'Downloading…'
}

interface DownloadResult {
  available: true
  size?: number
  width?: number
  height?: number
  duration?: number
}

/**
 * Download a project's YouTube video and keep it. Streams the server's
 * newline-delimited JSON progress, reporting each event to `onProgress`, and
 * resolves once the copy is stored. The project's own source decides *what* is
 * downloaded — the client sends only the quality — so this is always the video
 * the board is of.
 */
export async function downloadVideo(
  projectId: string,
  quality: VideoQuality = DEFAULT_QUALITY,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const res = await fetch(`${localVideoUrl(projectId)}?q=${quality}`, { method: 'POST' })
  // A validation/permission failure comes back as plain JSON with a 4xx and no
  // stream.
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || "That video couldn't be downloaded.")
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let done: DownloadResult | null = null
  for (;;) {
    const { value, done: end } = await reader.read()
    if (end) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const evt = JSON.parse(line) as
        | ({ type: 'progress' } & DownloadProgress)
        | ({ type: 'done' } & DownloadResult)
        | { type: 'error'; error: string }
      if (evt.type === 'progress') onProgress?.(evt)
      else if (evt.type === 'error') throw new Error(evt.error)
      else if (evt.type === 'done') done = evt
    }
  }
  if (!done) throw new Error("The download didn't finish. Try again in a moment.")
  return done
}

export interface LocalVideo {
  /** A downloaded copy is stored and ready to play. */
  available: boolean
  /** Still checking whether one exists. */
  probing: boolean
  /** The reader is playing the downloaded copy rather than the YouTube embed. */
  preferLocal: boolean
  setPreferLocal: (on: boolean) => void
  /** A download is in flight, with its latest progress. */
  downloading: boolean
  progress: DownloadProgress | null
  error: string | null
  /** Start a download at `quality`; flips to the local copy when it lands. */
  start: (quality?: VideoQuality) => void
}

/**
 * Session state for a track's downloaded copy — whether one exists, whether the
 * reader is watching it, and a download in flight. Like the score's zoom and
 * the lyrics' visibility it is the reader's own and persists nowhere: the copy
 * itself (the Blob object) is the durable fact, probed on open.
 *
 * `enabled` gates the probe to YouTube tracks; everything is inert otherwise.
 */
export function useLocalVideo(projectId: string | null, enabled: boolean): LocalVideo {
  const [available, setAvailable] = useState(false)
  const [probing, setProbing] = useState(false)
  const [preferLocal, setPreferLocal] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The download outliving a track switch would set state on the wrong board.
  const liveRef = useRef(projectId)
  liveRef.current = projectId

  // A fresh track: forget the last one's copy, then probe this one.
  useEffect(() => {
    setAvailable(false)
    setPreferLocal(false)
    setDownloading(false)
    setProgress(null)
    setError(null)
    if (!projectId || !enabled) return
    let cancelled = false
    setProbing(true)
    probeLocalVideo(projectId)
      .then((p) => {
        if (cancelled) return
        setAvailable(p.available)
        // Nothing to watch yet, but a teacher who downloaded it means to watch
        // it — open on the local copy when there is one.
        if (p.available) setPreferLocal(true)
      })
      .catch(() => {})
      .finally(() => !cancelled && setProbing(false))
    return () => {
      cancelled = true
    }
  }, [projectId, enabled])

  const start = useCallback(
    (quality: VideoQuality = DEFAULT_QUALITY) => {
      if (!projectId || downloading) return
      const forId = projectId
      setDownloading(true)
      setError(null)
      setProgress(null)
      downloadVideo(forId, quality, (p) => {
        if (liveRef.current === forId) setProgress(p)
      })
        .then(() => {
          if (liveRef.current !== forId) return
          setAvailable(true)
          setPreferLocal(true)
        })
        .catch((e: unknown) => {
          if (liveRef.current !== forId) return
          setError(e instanceof Error ? e.message : 'The download failed.')
        })
        .finally(() => {
          if (liveRef.current === forId) {
            setDownloading(false)
            setProgress(null)
          }
        })
    },
    [projectId, downloading],
  )

  return {
    available,
    probing,
    preferLocal,
    setPreferLocal,
    downloading,
    progress,
    error,
    start,
  }
}
