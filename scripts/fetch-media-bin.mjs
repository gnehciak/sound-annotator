// Fetch everything the clip export spawns (api/_lib/media.ts) into api/_bin:
// the yt-dlp and ffmpeg binaries, and bgutil-ytdlp-pot-provider — its yt-dlp
// plugin and its Node token-generator, built here from a pinned tag. Runs as
// part of the Vercel build (see vercel.json); api/_bin is gitignored and
// reaches the function through `includeFiles`.
//
// Nothing under api/_bin is committed, on purpose: the generator is GPL-3
// (fetched and built, never vendored), and its `canvas` dependency ships a
// native binary for whichever platform installs it, which has to be the
// build's Linux. Pinned by URL. `sabr` is the yt-dlp maintainers' pre-release
// of the SABR downloader (yt-dlp/yt-dlp#13515) — a moving tag, deliberately:
// it tracks upstream master, and a stale YouTube extractor is worse than a
// fresh one. Once that PR lands in a release, point YT_DLP at the official
// binary. Idempotent: anything already present is kept (`--force` refetches).
import { execSync } from 'node:child_process'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BIN = path.join(ROOT, 'api/_bin')
const FORCE = process.argv.includes('--force')

const YT_DLP = 'https://github.com/bashonly/yt-dlp/releases/download/sabr/yt-dlp_linux'
const FFMPEG = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-linux-x64'
const BGUTIL_TAG = '2.0.0'
const BGUTIL = `https://github.com/Brainicism/bgutil-ytdlp-pot-provider`

const log = (m) => console.log(`[media-bin] ${m}`)

async function download(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function fetchBinary(url, name) {
  const dst = path.join(BIN, name)
  if (existsSync(dst) && !FORCE) return log(`${name} present, skipping`)
  log(`fetching ${name}`)
  const buf = await download(url)
  // ELF magic — a GitHub error page saved as a binary would only fail later,
  // inside a function, where it costs a request to find out.
  if (buf.subarray(0, 4).toString('latin1') !== '\x7fELF')
    throw new Error(`${name}: not a Linux executable (${buf.length} bytes)`)
  const part = `${dst}.part`
  writeFileSync(part, buf)
  chmodSync(part, 0o755)
  renameSync(part, dst)
  log(`${name}: ${(buf.length / 1e6).toFixed(1)} MB`)
}

/** The yt-dlp plugin: a zip of `yt_dlp_plugins/…` for `--plugin-dirs`. */
async function fetchPlugin() {
  const dir = path.join(BIN, 'plugins')
  if (existsSync(path.join(dir, 'yt_dlp_plugins')) && !FORCE) return log('plugin present, skipping')
  log(`fetching bgutil plugin ${BGUTIL_TAG}`)
  const zip = await download(`${BGUTIL}/releases/download/${BGUTIL_TAG}/bgutil-ytdlp-pot-provider.zip`)
  rmSync(dir, { recursive: true, force: true })
  for (const [name, data] of Object.entries(unzipSync(new Uint8Array(zip)))) {
    if (name.endsWith('/')) continue
    const out = path.join(dir, name)
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, data)
  }
}

/** The token generator: the repo's `server/` at the tag, built with its own
 *  toolchain, then pruned to what `generate_once.js` needs at runtime. */
async function buildGenerator() {
  const dir = path.join(BIN, 'bgutil')
  if (existsSync(path.join(dir, 'build/generate_once.js')) && existsSync(path.join(dir, 'node_modules')) && !FORCE)
    return log('token generator present, skipping')
  log(`fetching bgutil-ytdlp-pot-provider ${BGUTIL_TAG} source`)
  const tgz = await download(`${BGUTIL}/archive/refs/tags/${BGUTIL_TAG}.tar.gz`)
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'bgutil-'))
  writeFileSync(path.join(tmp, 'src.tgz'), tgz)
  execSync('tar -xzf src.tgz', { cwd: tmp, stdio: 'inherit' })
  const server = path.join(tmp, `bgutil-ytdlp-pot-provider-${BGUTIL_TAG}`, 'server')
  rmSync(dir, { recursive: true, force: true })
  cpSync(server, dir, { recursive: true })
  rmSync(tmp, { recursive: true, force: true })
  const run = (cmd) => {
    log(cmd)
    execSync(cmd, { cwd: dir, stdio: 'inherit' })
  }
  run('npm ci --no-audit --no-fund')
  run('npx tsc')
  run('npm prune --omit=dev --no-audit --no-fund')
  // Only the runtime stays: the generator's TypeScript sources, its own
  // scripts and its Dockerfile would otherwise ride in the bundle — and its
  // .ts files would be picked up by this project's own `tsc -b`.
  for (const f of readdirSync(dir))
    if (!['build', 'node_modules', 'package.json', 'package-lock.json'].includes(f))
      rmSync(path.join(dir, f), { recursive: true, force: true })
  for (const f of readdirSync(path.join(dir, 'build')))
    if (f.endsWith('.map')) rmSync(path.join(dir, 'build', f), { force: true })
}

mkdirSync(BIN, { recursive: true })
await fetchBinary(YT_DLP, 'yt-dlp')
await fetchBinary(FFMPEG, 'ffmpeg')
await fetchPlugin()
await buildGenerator()
log('done')
