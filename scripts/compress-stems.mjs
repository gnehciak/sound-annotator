// Retro-compress the Demucs stems already in Blob.
//
//   node --env-file=.env.local scripts/compress-stems.mjs [--commit] [--limit N]
//
// AI section detection used to store the analyzer's stems as lossless WAV
// (vocals/drums/bass/guitar/piano/other, under users/{uid}/stems/{projectId}/).
// At ~90% of the whole Blob store, they were the store. New analyses now land
// compressed (api/projects/[id]/analyze.ts); this brings the old ones down to
// the same AAC m4a — a study aid for the stem mixer, not a master.
//
// For each live project whose analysis.stems point at a non-m4a file, each
// stem is transcoded (ffmpeg, read straight from the Blob URL), uploaded as
// {name}.m4a beside it, the row's analysis.stems rewritten to the new URLs,
// and only then the old WAV deleted. That order is deliberate: a crash leaves
// the row pointing at bytes that still exist, so a re-run simply finishes the
// job. Idempotent — a project already on m4a is skipped.
//
// Dry-run by default (reports the projects and the bytes it would reclaim via
// a HEAD per stem); pass --commit to transcode, store, rewrite and delete.
// Needs ffmpeg on PATH (or FFMPEG_PATH), DATABASE_URL and BLOB_READ_WRITE_TOKEN.
import { neon } from '@neondatabase/serverless'
import { put, del, head } from '@vercel/blob'
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sql = neon(process.env.DATABASE_URL)
const token = process.env.BLOB_READ_WRITE_TOKEN
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
const commit = process.argv.includes('--commit')
const limitArg = process.argv.indexOf('--limit')
const limit = limitArg >= 0 ? Number(process.argv[limitArg + 1]) : Infinity

if (!process.env.DATABASE_URL) die('DATABASE_URL is not set (run with --env-file=.env.local)')
if (!token) die('BLOB_READ_WRITE_TOKEN is not set')

function die(msg) {
  console.error(msg)
  process.exit(1)
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`

/** Transcode a stem (a URL ffmpeg can read) to a local AAC m4a; returns the
 *  path. Mirrors api/_lib/media.ts's encodeStemToM4a — 128k AAC, faststart. */
function transcode(url, outDir) {
  const out = path.join(outDir, `${Math.random().toString(36).slice(2)}.m4a`)
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-reconnect', '1', '-reconnect_streamed', '1', '-seekable', '1',
    '-i', url,
    '-vn', '-sn', '-dn',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    out,
  ]
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 && existsSync(out)) resolve(out)
      else reject(new Error(stderr.slice(-400) || `ffmpeg exited ${code}`))
    })
  })
}

const rows = await sql`
  SELECT id, owner_id, title, analysis
  FROM projects
  WHERE deleted_at IS NULL AND analysis->'stems' IS NOT NULL
  ORDER BY id
`
// Only projects with at least one non-m4a stem need doing.
const isWav = (u) => typeof u === 'string' && !/\.m4a(\?|$)/i.test(u)
const todo = rows
  .map((r) => ({
    ...r,
    stems: r.analysis?.stems ?? {},
    old: Object.entries(r.analysis?.stems ?? {}).filter(([, u]) => isWav(u)),
  }))
  .filter((r) => r.old.length > 0)
  .slice(0, limit)

console.log(
  `${rows.length} analyzed projects, ${todo.length} with uncompressed stems` +
    (Number.isFinite(limit) ? ` (limited to ${limit})` : ''),
)
if (todo.length === 0) process.exit(0)

let before = 0
let after = 0
let reuploaded = 0
let failed = 0

for (const proj of todo) {
  const label = JSON.stringify(proj.title ?? '').slice(0, 40)
  console.log(`\n${proj.id}  ${label}  — ${proj.old.length} stem(s)`)
  const tmp = commit ? mkdtempSync(path.join(os.tmpdir(), 'stems-')) : null
  const nextStems = { ...proj.stems }
  const toDelete = []
  let projFailed = false

  try {
    for (const [name, url] of proj.old) {
      // Current size, for the reclaim estimate.
      let size = 0
      try {
        size = (await head(url, { token })).size
      } catch {
        /* gone or unreadable — report 0, still attempt below */
      }
      before += size

      if (!commit) {
        console.log(`  ${name}: ${mb(size)} → ~m4a (dry run)`)
        continue
      }
      try {
        const file = await transcode(url, tmp)
        const bytes = statSync(file).size
        // A plausible stem is far bigger than this; anything tiny means ffmpeg
        // produced a dud, and we must not delete the WAV for it.
        if (bytes < 10_000) throw new Error(`output only ${bytes} bytes`)
        const pathname = `users/${proj.owner_id}/stems/${proj.id}/${name}.m4a`
        const blob = await put(pathname, createReadStream(file), {
          access: 'public',
          token,
          allowOverwrite: true,
          contentType: 'audio/mp4',
        })
        after += bytes
        reuploaded += 1
        // Rewrite only after the new object is stored; delete only after the
        // row points at it (below), so a crash never strands the mixer.
        nextStems[name] = blob.url
        if (blob.url !== url) toDelete.push(url)
        console.log(`  ${name}: ${mb(size)} → ${mb(bytes)}`)
      } catch (e) {
        projFailed = true
        failed += 1
        console.warn(`  ${name}: FAILED — ${e.message}`)
      }
    }

    if (commit && !projFailed) {
      await sql`
        UPDATE projects
        SET analysis = jsonb_set(analysis, '{stems}', ${JSON.stringify(nextStems)}::jsonb)
        WHERE id = ${proj.id}
      `
      // The row now points at the m4a copies — safe to drop the WAVs.
      for (const u of toDelete) {
        try {
          await del(u, { token })
        } catch (e) {
          console.warn(`  (could not delete old ${u.slice(-24)}: ${e.message})`)
        }
      }
    } else if (commit && projFailed) {
      console.warn(`  left ${proj.id} untouched — a stem failed, so the row still points at the WAVs`)
    }
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('\n——')
if (commit) {
  console.log(`re-uploaded ${reuploaded} stem(s), ${failed} failed`)
  console.log(`was ${mb(before)} of WAV → ${mb(after)} of m4a  (saved ${mb(before - after)})`)
} else {
  console.log(`would compress ${todo.reduce((n, p) => n + p.old.length, 0)} stem(s) across ${todo.length} project(s)`)
  console.log(`current WAV weight: ${mb(before)} — run with --commit to compress`)
}
