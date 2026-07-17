/** Extract an 11-char YouTube video id from a URL or raw id. */
export function parseVideoId(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value
  try {
    const url = new URL(value)
    if (url.hostname.includes('youtu.be')) {
      const id = url.pathname.slice(1).split('/')[0]
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }
    const v = url.searchParams.get('v')
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v
    const m = url.pathname.match(/\/(embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/)
    if (m) return m[2]
  } catch {
    /* not a URL */
  }
  return null
}

/**
 * Seconds from a YouTube time param — plain seconds ("90") or YouTube's
 * duration form ("1h2m3s", "1m30s", "90s"). null when it's neither.
 */
export function parseYouTubeTime(input: string): number | null {
  const v = input.trim().toLowerCase()
  if (/^\d+$/.test(v)) return Number(v)
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || (!m[1] && !m[2] && !m[3])) return null
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)
}

/**
 * The clip window a YouTube link already carries in its own params — `t` or
 * `start` (what "Copy link at current time" writes) and `end`. Used to prefill
 * the source picker's clip fields, so pasting a link that points at a moment
 * lands the track there.
 */
export function parseClipWindow(input: string): {
  start?: number
  end?: number
} {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return {}
  }
  const read = (key: string) => {
    const raw = url.searchParams.get(key)
    const secs = raw == null ? null : parseYouTubeTime(raw)
    return secs != null && secs > 0 ? secs : undefined
  }
  return { start: read('start') ?? read('t'), end: read('end') }
}

/** Fetch a video's title via the public oEmbed endpoint (no API key). */
export async function fetchVideoTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`,
    )
    if (!res.ok) return null
    const data: unknown = await res.json()
    const title = (data as { title?: unknown }).title
    return typeof title === 'string' && title.trim() ? title.trim() : null
  } catch {
    return null
  }
}

let apiPromise: Promise<unknown> | null = null

/** Lazily load the YouTube IFrame Player API exactly once. */
export function loadYouTubeApi(): Promise<unknown> {
  const w = window as unknown as {
    YT?: { Player: unknown }
    onYouTubeIframeAPIReady?: () => void
  }
  if (w.YT && w.YT.Player) return Promise.resolve(w.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prev?.()
      resolve(w.YT)
    }
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
  })
  return apiPromise
}
