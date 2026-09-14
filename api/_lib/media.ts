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
// first use. Fluid Compute keeps /tmp between invocations on a warm instance,
// which is what makes the audio cache worth having: a class exporting thirty
// clips of one song costs one YouTube fetch per instance, not thirty.
//
// Locally (macOS dev) the binaries on PATH are used, without the token
// plugin: a signed-out residential address is served the plain streams and
// needs neither cookies nor a token.
import { spawn } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
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

function run(cmd: string, args: string[], timeoutMs: number): Promise<RunResult> {
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
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
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
const inflight = new Map<string, Promise<string>>()

/**
 * The whole recording's audio for a YouTube video, as a path in /tmp — an
 * m4a (audio-only over SABR) or, on the fallback path, an mp4 whose audio
 * track ffmpeg will lift out. Cached per warm instance.
 */
export function fetchYouTubeAudio(videoId: string): Promise<string> {
  if (!/^[\w-]{11}$/.test(videoId)) throw new MediaError(400, 'Not a YouTube video id')
  const cached = findCached(videoId)
  if (cached) {
    // Touch it: eviction is by age, and a song a class keeps exporting is
    // exactly the one to keep.
    const now = new Date()
    utimesSync(cached, now, now)
    return Promise.resolve(cached)
  }
  let p = inflight.get(videoId)
  if (!p) {
    p = download(videoId).finally(() => inflight.delete(videoId))
    inflight.set(videoId, p)
  }
  return p
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
