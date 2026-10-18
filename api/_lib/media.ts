// Server-side media tooling for the clip export (api/projects/[id]/clip.ts):
// the yt-dlp and ffmpeg binaries, a YouTube audio fetch with a warm-instance
// cache, and the ffmpeg cut that turns a whole recording into a clip.
//
// Everything here runs as a child process of a Vercel *Node* function, and
// that choice is load-bearing. yt-dlp needs a JavaScript runtime to solve
// YouTube's player challenges, and the proof-of-origin token YouTube now
// demands is minted by a Node script (bgutil-ytdlp-pot-provider). Vercel's
// Python runtime ships neither Node nor Deno; the Node runtime *is* one — so
// the function hands its own `process.execPath` to yt-dlp as the runtime for
// both, and one function carries the whole pipeline.
//
// Three facts about YouTube, measured 2026-09-14 and worth keeping:
//  - From a datacenter address every anonymous request is bot-walled ("Sign in
//    to confirm you're not a bot"), whatever client yt-dlp impersonates and
//    even with a PO token. A signed-in session's cookies are the only way past
//    it, hence YT_COOKIES_B64 — the youtube.com lines of a Netscape cookie
//    file, base64. Use a throwaway Google account: YouTube may rate-limit or
//    ban the account behind heavy automated use.
//  - A signed-in session is served SABR-only: no plain https audio streams,
//    only format 18 (360p mp4 with AAC). Audio-only (140, a 3 MB m4a for a
//    3-minute song) needs yt-dlp's SABR downloader, which is still a pull
//    request (yt-dlp/yt-dlp#13515) shipped as a prebuilt binary from the
//    maintainer's `sabr` pre-release — scripts/fetch-media-bin.mjs pins it.
//  - SABR needs a GVS PO token, generated per video by the bgutil script
//    (api/_bin/bgutil, `npm ci`'d at build so `canvas` gets Linux binaries).
// The format selector below falls through SABR → any audio → format 18, so
// if the pre-release breaks the clip still comes out, from the mp4's audio
// track, a second slower.
//
// The binaries live under api/_bin (fetched at build, gitignored) and reach
// the function through `includeFiles` in vercel.json. The bundle is
// read-only and its files aren't executable, so each is copied to /tmp on
// first use.
//
// A recording is fetched from YouTube **once**, then kept in two places. In
// Blob, under `cache/youtube/<videoId>.<ext>` (api/_lib/mediaCache.ts) —
// private access, so no URL to a whole song ever exists — shared by every
// project that points at that video, whoever made it: the teacher's track,
// thirty students' copies and next year's class all read one object. And in
// /tmp, which Fluid Compute keeps between invocations on a warm instance, so
// a class exporting thirty clips of one song costs one Blob read per
// instance and no YouTube fetch at all. The store write rides `waitUntil`
// after the response, so the first clip of a song pays nothing for it.
//
// Locally (macOS dev) the binaries on PATH are used, without the token
// plugin: a signed-out residential address is served the plain streams and
// needs neither cookies nor a token.
import { get, list, put } from '@vercel/blob'
import { waitUntil } from '@vercel/functions'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { MEDIA_CACHE_PREFIX, VIDEO_CACHE_PREFIX } from './mediaCache.js'

const BIN_DIR = path.join(process.cwd(), 'api/_bin')
const BUNDLED = process.platform === 'linux'
const TMP = '/tmp'
const AUDIO_CACHE = path.join(TMP, 'yt-audio')
/** Evict the oldest cached recordings past this. /tmp is 500 MB on Vercel. */
const AUDIO_CACHE_MAX_BYTES = 300 * 1024 * 1024
const YTDLP_TIMEOUT_MS = 150_000
const FFMPEG_TIMEOUT_MS = 120_000

/** The bundle is read-only: copy a binary to /tmp (once per instance) and
 *  make it executable. The rename makes the copy atomic against a second
 *  invocation on the same instance racing the first. */
function bundled(name: string): string {
  const dir = path.join(TMP, 'media-bin')
  const dst = path.join(dir, name)
  if (existsSync(dst)) return dst
  mkdirSync(dir, { recursive: true })
  const part = `${dst}.${process.pid}.part`
  copyFileSync(path.join(BIN_DIR, name), part)
  chmodSync(part, 0o755)
  renameSync(part, dst)
  return dst
}

/** Locally, whatever is on PATH — or an explicit path in .env.local
 *  (`YTDLP_PATH`, `FFMPEG_PATH`) when the one on PATH is too old. */
const ytDlp = () => (BUNDLED ? bundled('yt-dlp') : process.env.YTDLP_PATH || 'yt-dlp')
const ffmpeg = () => (BUNDLED ? bundled('ffmpeg') : process.env.FFMPEG_PATH || 'ffmpeg')

interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
  onOutput?: (chunk: string) => void,
): Promise<RunResult> {
  return new Promise((resolve) => {
    // The PO-token plugin and yt-dlp's challenge solver both look for `node`
    // — this process's own runtime, which isn't on the function's PATH.
    const PATH = `${path.dirname(process.execPath)}:${process.env.PATH ?? ''}`
    const child = spawn(cmd, args, {
      env: { ...process.env, PATH, HOME: TMP, XDG_CACHE_HOME: path.join(TMP, 'cache') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    // yt-dlp prints progress on both streams, so watch both.
    child.stdout.on('data', (d) => {
      stdout += d
      onOutput?.(String(d))
    })
    child.stderr.on('data', (d) => {
      stderr += d
      onOutput?.(String(d))
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}\n${String(e)}` })
    })
  })
}

/** The last few lines of yt-dlp's stderr, URLs stripped (they carry signed
 *  stream tokens) — what a log line or an error message should carry. */
function tail(stderr: string): string {
  return stderr
    .replace(/https?:\/\/\S+/g, '<url>')
    .split('\n')
    .filter((l) => /^(ERROR|WARNING)/.test(l))
    .slice(-3)
    .join(' | ')
    .slice(0, 600)
}

export class MediaError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'MediaError'
    this.status = status
  }
}

/** Written once per instance: yt-dlp rewrites its cookie file on exit, and a
 *  fresh copy each call would throw away the rotation. */
function cookieFile(): string | null {
  const raw = process.env.YT_COOKIES_B64
  if (!raw) return null
  const p = path.join(TMP, 'yt-cookies.txt')
  if (!existsSync(p)) writeFileSync(p, Buffer.from(raw, 'base64'))
  return p
}

/** One in-flight fetch per video per instance, so parallel exports of the
 *  same song wait on one download rather than starting thirty. */
const inflight = new Map<string, Promise<FetchedAudio>>()

/**
 * The whole recording's audio for a YouTube video, as a path in /tmp — an
 * m4a (audio-only over SABR) or, on the fallback path, an mp4 whose audio
 * track ffmpeg will lift out. Cached per warm instance.
 */
export type AudioOrigin = 'instance' | 'store' | 'youtube'
export interface FetchedAudio {
  file: string
  /** Where it came from — surfaced as a response header for diagnosis. */
  from: AudioOrigin
}

export function fetchYouTubeAudio(videoId: string): Promise<FetchedAudio> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new MediaError(400, 'Not a YouTube video id')
  const cached = findCached(videoId)
  if (cached) {
    // Touch it: eviction is by age, and a song a class keeps exporting is
    // exactly the one to keep.
    const now = new Date()
    utimesSync(cached, now, now)
    return Promise.resolve({ file: cached, from: 'instance' })
  }
  let p = inflight.get(videoId)
  if (!p) {
    p = fromStore(videoId)
      .then(async (hit): Promise<FetchedAudio> =>
        hit ? { file: hit, from: 'store' } : { file: await download(videoId), from: 'youtube' },
      )
      .finally(() => inflight.delete(videoId))
    inflight.set(videoId, p)
  }
  return p
}

/**
 * Where the cache lives. A *private* store when one is wired up
 * (`BLOB_CACHE_READ_WRITE_TOKEN`, a second Blob store created with private
 * access), so no URL to a whole song exists at all. Otherwise the app's own
 * public store, where the object is found by prefix and its URL carries a
 * random suffix — unguessable, which is the same credential every share link
 * and note image in this app already rests on. The main store is public-only:
 * private access on it is refused by the SDK, measured 2026-09-14.
 */
function store(): { token: string; access: 'private' | 'public' } | null {
  const cache = process.env.BLOB_CACHE_READ_WRITE_TOKEN
  if (cache) return { token: cache, access: 'private' }
  const main = process.env.BLOB_READ_WRITE_TOKEN
  return main ? { token: main, access: 'public' } : null
}

const CONTENT_TYPES: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
}

/** The recording from Blob into /tmp, or null when nobody has fetched this
 *  video yet. Any failure reads as a miss: the store is a cache, and a
 *  YouTube fetch is the right answer to a cache that won't answer. */
async function fromStore(videoId: string): Promise<string | null> {
  const st = store()
  if (!st) return null
  try {
    // The name is `<videoId>.<ext>` or, with the public store's random
    // suffix, `<videoId>-<suffix>.<ext>`; ids are fixed-width, so the bare id
    // is prefix enough and never the prefix of another.
    const page = await list({ prefix: `${MEDIA_CACHE_PREFIX}${videoId}`, limit: 5, token: st.token })
    const hit = page.blobs.find((b) => !b.pathname.endsWith('.part'))
    if (!hit) return null
    const got = await get(hit.url, { access: st.access, token: st.token })
    if (!got) return null
    mkdirSync(AUDIO_CACHE, { recursive: true })
    const dst = path.join(AUDIO_CACHE, `${videoId}${path.extname(hit.pathname) || '.m4a'}`)
    const part = `${dst}.${process.pid}.part`
    await pipeline(Readable.fromWeb(got.stream as import('stream/web').ReadableStream), createWriteStream(part))
    renameSync(part, dst)
    console.log(`[clip] ${videoId}: from the store (${hit.size} bytes)`)
    return dst
  } catch (e) {
    console.error(`[clip] ${videoId}: store read failed, fetching instead:`, e)
    return null
  }
}

/** Keep a just-fetched recording for everyone else, after the response has
 *  gone out. A failure is logged and costs nothing but the next fetch. */
function toStore(videoId: string, file: string): void {
  const st = store()
  if (!st) return
  const ext = path.extname(file)
  const pathname = `${MEDIA_CACHE_PREFIX}${videoId}${ext}`
  const job = (async () => {
    // Two fresh instances asked for the same never-seen song at once both
    // fetched it; only the first to get here keeps its copy. The suffix
    // below means a second write would be a second object, not a replace.
    const already = await list({ prefix: `${MEDIA_CACHE_PREFIX}${videoId}`, limit: 1, token: st.token })
    if (already.blobs.length) return
    const b = await put(pathname, createReadStream(file), {
      access: st.access,
      token: st.token,
      // On the public store the suffix is what keeps the URL unguessable; the
      // lookup is by prefix, so the name needn't be exact. A private store
      // needs neither, but the same shape costs nothing.
      addRandomSuffix: true,
      contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream',
    })
    console.log(`[clip] ${videoId}: stored as ${b.pathname}`)
  })().catch((e) => console.error(`[clip] ${videoId}: store write failed:`, e))
  try {
    waitUntil(job)
  } catch {
    // Not inside a Vercel function (local dev): the write still runs, only
    // nothing holds the process open for it.
  }
}

function findCached(videoId: string): string | null {
  if (!existsSync(AUDIO_CACHE)) return null
  const hit = readdirSync(AUDIO_CACHE).find(
    (f) => f.startsWith(`${videoId}.`) && !f.endsWith('.part'),
  )
  return hit ? path.join(AUDIO_CACHE, hit) : null
}

async function download(videoId: string): Promise<string> {
  mkdirSync(AUDIO_CACHE, { recursive: true })
  evict()
  const args = [
    '--js-runtimes', `node:${process.execPath}`,
    '--no-progress',
    '--no-playlist',
    '-o', path.join(AUDIO_CACHE, `${videoId}.%(ext)s`),
  ]
  const cookies = cookieFile()
  if (cookies) args.push('--cookies', cookies)
  if (BUNDLED) {
    // SABR audio-only first; then any plain audio stream; then format 18,
    // the a+v mp4 every signed-in session is left with. Only the bundled
    // (SABR pre-release) binary can read a SABR stream — asked of a stock
    // yt-dlp, `formats=duplicate` lists one it then 403s on.
    args.push('--extractor-args', 'youtube:formats=duplicate')
    args.push('-f', 'ba[protocol=sabr][ext=m4a]/ba[protocol=sabr]/ba[ext=m4a]/ba/b[height<=360]/b')
    args.push('--plugin-dirs', path.join(BIN_DIR, 'plugins'))
    args.push('--extractor-args', `youtubepot-bgutilscript:server_home=${path.join(BIN_DIR, 'bgutil')}`)
  } else {
    args.push('-f', 'ba[ext=m4a]/ba/b[height<=360]/b')
    // A pip/brew yt-dlp doesn't bundle the challenge-solver script the
    // official executable carries; let it fetch the pinned one.
    args.push('--remote-components', 'ejs:github')
  }
  args.push(`https://www.youtube.com/watch?v=${videoId}`)
  const r = await run(ytDlp(), args, YTDLP_TIMEOUT_MS)
  const file = findCached(videoId)
  if (r.code !== 0 || !file) {
    console.error(`[clip] yt-dlp (${ytDlp()}) failed for ${videoId}: ${tail(r.stderr)}`)
    const msg = tail(r.stderr)
    if (/private|unavailable|removed|not available/i.test(msg))
      throw new MediaError(404, 'That video is not available to download.')
    throw new MediaError(502, "YouTube didn't hand over the audio. Try again in a moment.")
  }
  toStore(videoId, file)
  return file
}

/** Drop the oldest cached recordings until the cache is under its cap. */
function evict(): void {
  const files = readdirSync(AUDIO_CACHE)
    .map((f) => {
      const p = path.join(AUDIO_CACHE, f)
      const s = statSync(p)
      return { p, size: s.size, mtime: s.mtimeMs }
    })
    .sort((a, b) => a.mtime - b.mtime)
  let total = files.reduce((n, f) => n + f.size, 0)
  for (const f of files) {
    if (total <= AUDIO_CACHE_MAX_BYTES) break
    try {
      unlinkSync(f.p)
      total -= f.size
    } catch {
      /* already gone */
    }
  }
}

// ── The downloaded video ──────────────────────────────────────────────────
//
// "Download the video and play the downloaded copy." YouTube's embed is a
// cross-origin iframe with a scriptable clock but no file behind it; a teacher
// who wants the picture to keep playing when the embed is geo-blocked, muted
// ("your account is being used on another device") or simply gone can pull the
// whole video down once. We fetch video+audio and merge to a single mp4 — the
// exact pipeline the clip export uses for audio, only selecting a video stream
// too — store it under VIDEO_CACHE_PREFIX (shared across projects of the same
// video, like the audio cache), and a plain `<video>` plays it back through a
// Range proxy. Only ever for YouTube: a Drive video and an audio URL already
// stream straight into a media element, so there is nothing to download.

/** The merged file is refused over this — the ceiling on a kept picture. The
 *  work file lands in /tmp (500 MB on Vercel, shared with the audio cache and
 *  the binaries), so the cap is well under that. */
export const VIDEO_MAX_BYTES = 350 * 1024 * 1024
/** Default height cap: 720p keeps a long video from quietly pulling a 4K
 *  master that would blow the /tmp budget. "best" (no cap) is still offered. */
export const VIDEO_QUALITY_HEIGHTS = [360, 480, 720, 1080] as const
const VIDEO_DOWNLOAD_TIMEOUT_MS = 280_000

export type VideoDownloadStage = 'download' | 'merge' | 'save'
export interface VideoDownloadProgress {
  stage: VideoDownloadStage
  /** 0–100 for the stream currently downloading; omitted when unknown. A
   *  video+audio fetch is two passes (each 0→100), so the percent resets once;
   *  the caller shows it with the stage label rather than as one smooth bar. */
  percent?: number
}

export interface DownloadedVideo {
  /** The merged file in /tmp. The caller stores it, then removes `workDir`. */
  file: string
  workDir: string
  ext: string
  mime: string
  size: number
  width?: number
  height?: number
  duration?: number
}

interface VideoInfo {
  width?: unknown
  height?: unknown
  duration?: unknown
}

/**
 * Download YouTube video `videoId` (with audio) merged to a single mp4 in
 * /tmp. `maxHeight` caps the picture (undefined = best the site offers). The
 * caller moves the file into storage and removes the returned `workDir`.
 */
export async function downloadYouTubeVideo(
  videoId: string,
  opts: { maxHeight?: number; onProgress?: (p: VideoDownloadProgress) => void } = {},
): Promise<DownloadedVideo> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new MediaError(400, 'Not a YouTube video id')
  const workDir = mkdtempSync(path.join(TMP, 'vid-'))
  const out = path.join(workDir, 'media.%(ext)s')

  const args = [
    '--newline',
    '--progress-template', 'download:KPROG %(progress._percent_str)s',
    '--no-playlist',
    '--restrict-filenames',
    '--write-info-json',
    '--merge-output-format', 'mp4',
    '-o', out,
    '--js-runtimes', `node:${process.execPath}`,
  ]
  // yt-dlp needs ffmpeg to merge separate video+audio streams. Point it at the
  // bundled binary (an absolute path) on Vercel, or an explicit FFMPEG_PATH;
  // locally, say nothing and let it find ffmpeg on PATH — a bare name here
  // reads as a path that "does not exist" and silently SKIPS the merge, leaving
  // two unmuxed files behind. (And no --no-warnings, so that warning shows.)
  const ff = ffmpeg()
  if (path.isAbsolute(ff)) args.push('--ffmpeg-location', ff)
  const cookies = cookieFile()
  if (cookies) args.push('--cookies', cookies)

  const cap = opts.maxHeight ? `[height<=${opts.maxHeight}]` : ''
  if (BUNDLED) {
    // SABR video+audio first; then any plain pair; then format 18 (the a+v mp4
    // every signed-in session is left with). Only the bundled SABR pre-release
    // reads a SABR stream, which `formats=duplicate` surfaces.
    args.push('--extractor-args', 'youtube:formats=duplicate')
    args.push('-f', `bv*[protocol=sabr]${cap}+ba[protocol=sabr]/bv*${cap}+ba/b${cap}/18/b`)
    args.push('--plugin-dirs', path.join(BIN_DIR, 'plugins'))
    args.push('--extractor-args', `youtubepot-bgutilscript:server_home=${path.join(BIN_DIR, 'bgutil')}`)
  } else {
    args.push('-f', `bv*${cap}+ba/b${cap}/18/b`)
    // A pip/brew yt-dlp doesn't bundle the challenge-solver script.
    args.push('--remote-components', 'ejs:github')
  }
  args.push(`https://www.youtube.com/watch?v=${videoId}`)

  // Parse yt-dlp's `KPROG 42.3%` lines as they stream in.
  let obuf = ''
  const onOutput = opts.onProgress
    ? (chunk: string) => {
        obuf += chunk
        let nl: number
        while ((nl = obuf.indexOf('\n')) >= 0) {
          const line = obuf.slice(0, nl)
          obuf = obuf.slice(nl + 1)
          const m = line.match(/KPROG\s+([\d.]+)%/)
          if (m) opts.onProgress!({ stage: 'download', percent: Number(m[1]) })
          else if (/\[Merger\]|Merging formats/.test(line)) opts.onProgress!({ stage: 'merge' })
        }
      }
    : undefined

  const r = await run(ytDlp(), args, VIDEO_DOWNLOAD_TIMEOUT_MS, onOutput)
  const files = existsSync(workDir) ? readdirSync(workDir) : []
  // After a successful merge only `media.mp4` + `media.info.json` remain; a
  // `.part` or an unmerged `media.fNNN.*` means it didn't finish.
  const media = files.find(
    (f) => f.startsWith('media.') && !f.endsWith('.info.json') && !f.endsWith('.part'),
  )
  if (r.code !== 0 || !media) {
    rmSync(workDir, { recursive: true, force: true })
    const msg = tail(r.stderr)
    console.error(`[video] yt-dlp (${ytDlp()}) failed for ${videoId}: ${msg}`)
    if (/private|unavailable|removed|not available|members-only/i.test(msg))
      throw new MediaError(404, 'That video is not available to download.')
    throw new MediaError(502, "YouTube didn't hand over the video. Try again in a moment.")
  }

  const file = path.join(workDir, media)
  const size = statSync(file).size
  if (size > VIDEO_MAX_BYTES) {
    rmSync(workDir, { recursive: true, force: true })
    throw new MediaError(
      413,
      `That video is larger than ${Math.round(VIDEO_MAX_BYTES / 1024 / 1024)} MB — too big to keep. Try a lower quality.`,
    )
  }

  const info = readVideoInfo(workDir)
  const ext = path.extname(media).slice(1).toLowerCase()
  return {
    file,
    workDir,
    ext,
    mime: CONTENT_TYPES[`.${ext}`] ?? 'video/mp4',
    size,
    width: typeof info.width === 'number' ? info.width : undefined,
    height: typeof info.height === 'number' ? info.height : undefined,
    duration: typeof info.duration === 'number' ? Math.round(info.duration) : undefined,
  }
}

function readVideoInfo(dir: string): VideoInfo {
  try {
    const f = readdirSync(dir).find((n) => n.endsWith('.info.json'))
    if (!f) return {}
    return JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as VideoInfo
  } catch {
    return {}
  }
}

/**
 * The downloaded-video store. The main (public) Blob store, where the object's
 * URL carries a random suffix and stays unguessable — the video cache can't use
 * the private store the audio cache prefers, because a `<video>` seeks by Range
 * and the proxy answers that by fetching the object's own URL (see
 * mediaCache.ts). Null when no Blob token is configured (local dev without one).
 */
function videoStore(): string | null {
  return process.env.BLOB_READ_WRITE_TOKEN || null
}

export interface StoredVideo {
  /** The object's fetchable URL — used by the proxy, never sent to the client. */
  url: string
  size: number
  contentType: string
}

/** The stored copy of `videoId`, or null when nobody has downloaded it yet. */
export async function findStoredVideo(videoId: string): Promise<StoredVideo | null> {
  if (!/^[\w-]{11}$/.test(videoId)) return null
  const token = videoStore()
  if (!token) return null
  try {
    // `<videoId>-<suffix>.mp4`; ids are fixed-width, so the bare id is prefix
    // enough and never the prefix of another.
    const page = await list({ prefix: `${VIDEO_CACHE_PREFIX}${videoId}`, limit: 5, token })
    const hit = page.blobs.find((b) => !b.pathname.endsWith('.part'))
    if (!hit) return null
    const ext = path.extname(hit.pathname).toLowerCase()
    return { url: hit.url, size: hit.size, contentType: CONTENT_TYPES[ext] ?? 'video/mp4' }
  } catch (e) {
    console.error(`[video] ${videoId}: store lookup failed:`, e)
    return null
  }
}

/**
 * Store a just-downloaded video for every project of the same recording. Skips
 * the write when a copy already exists (two instances can download the same
 * never-seen video at once; the random suffix means a second write would be a
 * second object, not a replace). Returns the stored URL, or throws.
 */
export async function storeVideo(videoId: string, file: string, ext: string): Promise<StoredVideo> {
  const token = videoStore()
  if (!token) throw new MediaError(503, 'Video storage is not configured.')
  const existing = await findStoredVideo(videoId)
  if (existing) return existing
  const contentType = CONTENT_TYPES[`.${ext}`] ?? 'video/mp4'
  const b = await put(`${VIDEO_CACHE_PREFIX}${videoId}.${ext}`, createReadStream(file), {
    access: 'public',
    token,
    addRandomSuffix: true,
    contentType,
  })
  console.log(`[video] ${videoId}: stored as ${b.pathname}`)
  return { url: b.url, size: statSync(file).size, contentType }
}

/**
 * Cut `[start, end)` seconds out of `input` (a local file or an http(s) URL
 * ffmpeg can read) as an m4a. `copy` keeps the AAC frames as they are —
 * right for the YouTube audio we just fetched, and instant; a Drive file or
 * an audio URL of unknown codec is re-encoded instead, which for a clip is
 * still well under a second per minute.
 */
export async function cutClip(
  input: string,
  start: number,
  end: number,
  opts: { copy: boolean },
): Promise<Buffer> {
  const out = path.join(TMP, `clip-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`)
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...(input.startsWith('http') ? ['-reconnect', '1', '-reconnect_streamed', '1', '-seekable', '1'] : []),
    '-ss', start.toFixed(3),
    '-to', end.toFixed(3),
    '-i', input,
    '-vn', '-sn', '-dn',
    ...(opts.copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']),
    '-movflags', '+faststart',
    out,
  ]
  const r = await run(ffmpeg(), args, FFMPEG_TIMEOUT_MS)
  if (r.code !== 0 || !existsSync(out)) {
    console.error(`[clip] ffmpeg failed: ${r.stderr.replace(/https?:\/\/\S+/g, '<url>').slice(-600)}`)
    throw new MediaError(502, "Couldn't cut the clip from that recording.")
  }
  try {
    return readFileSync(out)
  } finally {
    try {
      unlinkSync(out)
    } catch {
      /* fine */
    }
  }
}

/**
 * The bitrate the Demucs stems are compressed to. They are study aids played
 * through a plain `<audio>` element (StemMixer), not masters, so AAC at this
 * rate is transparent enough for picking a part out — and ~30× smaller than
 * the lossless WAV the analyzer hands back (which was ~90% of the whole Blob
 * store). Stereo; Demucs separates in stereo.
 */
const STEM_BITRATE = '128k'

/**
 * Re-encode a Demucs stem to a compressed AAC m4a. `input` is the analyzer's
 * expiring WAV URL (or a local file), read straight by ffmpeg; the small m4a
 * comes back as a Buffer for the caller to store. Used both when a fresh
 * analysis lands (api/projects/[id]/analyze.ts) and by the retro-compression
 * script (scripts/compress-stems.mjs) for the WAV stems already in the store.
 */
export async function encodeStemToM4a(input: string): Promise<Buffer> {
  const out = path.join(TMP, `stem-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`)
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...(input.startsWith('http') ? ['-reconnect', '1', '-reconnect_streamed', '1', '-seekable', '1'] : []),
    '-i', input,
    '-vn', '-sn', '-dn',
    '-c:a', 'aac', '-b:a', STEM_BITRATE,
    '-movflags', '+faststart',
    out,
  ]
  const r = await run(ffmpeg(), args, FFMPEG_TIMEOUT_MS)
  if (r.code !== 0 || !existsSync(out)) {
    console.error(`[stem] ffmpeg failed: ${r.stderr.replace(/https?:\/\/\S+/g, '<url>').slice(-600)}`)
    throw new MediaError(502, 'Could not compress the stem.')
  }
  try {
    return readFileSync(out)
  } finally {
    try {
      unlinkSync(out)
    } catch {
      /* fine */
    }
  }
}

/**
 * Lift the audio track out of a video file as an m4a. Used by section detection
 * to feed the downloaded YouTube copy to the analyzer without a second YouTube
 * fetch or a manual audio upload.
 *
 * `input` is normally the stored copy's http URL — but we download it to /tmp
 * first and hand ffmpeg a *local* file rather than letting ffmpeg read the URL
 * itself. A merged mp4 can carry its `moov` atom at the end of the file, which
 * ffmpeg can only reach by seeking the remote resource mid-read; that is
 * fragile over http (and the reason this failed in the wild). A local file is
 * fully seekable, so the extract is reliable whatever the mp4's layout. The
 * audio is kept as-is (`-c:a copy`, instant) with a re-encode fallback for the
 * rare container whose audio isn't already a clean AAC stream.
 */
export async function extractAudioM4a(input: string): Promise<Buffer> {
  let local = input
  let downloaded: string | null = null
  if (input.startsWith('http')) {
    let res: Response
    try {
      res = await fetch(input)
    } catch {
      throw new MediaError(502, 'Could not read the downloaded video’s audio.')
    }
    if (!res.ok || !res.body)
      throw new MediaError(502, 'Could not read the downloaded video’s audio.')
    downloaded = path.join(TMP, `vidsrc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`)
    await pipeline(
      Readable.fromWeb(res.body as import('stream/web').ReadableStream),
      createWriteStream(downloaded),
    )
    local = downloaded
  }

  const out = path.join(TMP, `aud-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`)
  const build = (reencode: boolean) => [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-i', local,
    '-vn', '-sn', '-dn',
    ...(reencode ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'copy']),
    '-movflags', '+faststart',
    out,
  ]
  try {
    let r = await run(ffmpeg(), build(false), FFMPEG_TIMEOUT_MS)
    if (r.code !== 0 || !existsSync(out)) {
      // The audio wasn't a clean AAC stream to copy — re-encode it.
      try {
        unlinkSync(out)
      } catch {
        /* fine */
      }
      r = await run(ffmpeg(), build(true), FFMPEG_TIMEOUT_MS)
    }
    if (r.code !== 0 || !existsSync(out)) {
      console.error(`[audio] ffmpeg failed: ${r.stderr.replace(/https?:\/\/\S+/g, '<url>').slice(-600)}`)
      throw new MediaError(502, 'Could not read the downloaded video’s audio.')
    }
    return readFileSync(out)
  } finally {
    for (const f of [out, downloaded]) {
      if (!f) continue
      try {
        unlinkSync(f)
      } catch {
        /* fine */
      }
    }
  }
}

/**
 * Cut `[start, end)` seconds out of one or more stems as an m4a — the clip
 * export when the stem mixer has parts soloed, so the clip is what the listener
 * is hearing. One stem is copied (its AAC frames, instant); several are mixed
 * down (ffmpeg `amix`, which has to re-encode). `urls` are the stems' Blob
 * URLs; times are already mapped onto the recording by the caller.
 */
export async function cutStemClip(urls: string[], start: number, end: number): Promise<Buffer> {
  if (urls.length === 0) throw new MediaError(400, 'No stem to clip')
  const out = path.join(TMP, `stemclip-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.m4a`)
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin']
  // Seek each input to the same window, so the mixed parts stay aligned.
  for (const u of urls) {
    if (u.startsWith('http')) args.push('-reconnect', '1', '-reconnect_streamed', '1', '-seekable', '1')
    args.push('-ss', start.toFixed(3), '-to', end.toFixed(3), '-i', u)
  }
  if (urls.length > 1) {
    args.push('-filter_complex', `amix=inputs=${urls.length}:normalize=0`, '-c:a', 'aac', '-b:a', '192k')
  } else {
    args.push('-c:a', 'copy')
  }
  args.push('-vn', '-movflags', '+faststart', out)
  const r = await run(ffmpeg(), args, FFMPEG_TIMEOUT_MS)
  if (r.code !== 0 || !existsSync(out)) {
    console.error(`[stemclip] ffmpeg failed: ${r.stderr.replace(/https?:\/\/\S+/g, '<url>').slice(-600)}`)
    throw new MediaError(502, 'Could not cut the stem clip.')
  }
  try {
    return readFileSync(out)
  } finally {
    try {
      unlinkSync(out)
    } catch {
      /* fine */
    }
  }
}
