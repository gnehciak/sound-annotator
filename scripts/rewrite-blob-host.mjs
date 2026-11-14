// One-off (Nov 2026), the second half of scripts/migrate-blob-store.mjs: point
// every stored link at the Sydney public store. Pathnames were kept by the copy,
// so a link changes only in its host. Only `projects` holds blob links — in
// `source`, `annotations`, `settings` and `analysis` (scanned 14 Nov 2026).
//
// Every row it changes is first written whole (those four columns) to a backup
// file, and `--dry` reports what would change without writing anything. Rows
// the copy missed are refused rather than pointed at a file that isn't there.
// Re-runnable: a client still holding an old link can save it back, and a
// later run picks it up; the old store keeps serving it meanwhile.
//
//   node --env-file=<pulled production env> scripts/rewrite-blob-host.mjs [--dry]
//
// Needs DATABASE_URL, BLOB_SYD_READ_WRITE_TOKEN (or BLOB_READ_WRITE_TOKEN once
// it points at the new store) and OLD_BLOB_HOST (the iad1 store's host).
import { neon } from '@neondatabase/serverless'
import { list } from '@vercel/blob'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dry = process.argv.includes('--dry')
const OLD_HOST = process.env.OLD_BLOB_HOST
const NEW_TOKEN = process.env.BLOB_SYD_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN
if (!OLD_HOST || !NEW_TOKEN || !process.env.DATABASE_URL) throw new Error('Need OLD_BLOB_HOST, a new-store token and DATABASE_URL')
const sql = neon(process.env.DATABASE_URL)

// Every pathname in the new store, and its host.
const have = new Set()
let NEW_HOST
let cursor
do {
  const page = await list({ cursor, limit: 1000, token: NEW_TOKEN })
  for (const b of page.blobs) {
    have.add(b.pathname)
    NEW_HOST ??= new URL(b.url).hostname
  }
  cursor = page.hasMore ? page.cursor : undefined
} while (cursor)
if (!NEW_HOST || NEW_HOST === OLD_HOST) throw new Error('New store is empty or is the old one')

const COLS = ['source', 'annotations', 'settings', 'analysis']
const like = `%${OLD_HOST}%`
const rows = await sql.query(
  `SELECT id, ${COLS.join(', ')} FROM projects WHERE ${COLS.map((c) => `${c}::text LIKE $1`).join(' OR ')}`,
  [like],
)
const linkRe = new RegExp(`https://${OLD_HOST.replace(/\./g, '\\.')}/([^\\s"'<>)\\\\]+)`, 'g')
let missing = 0
const plan = []
for (const r of rows) {
  const cols = COLS.filter((c) => r[c] != null && JSON.stringify(r[c]).includes(OLD_HOST))
  const paths = new Set()
  for (const c of cols)
    for (const m of JSON.stringify(r[c]).matchAll(linkRe)) paths.add(decodeURIComponent(m[1].split('?')[0]))
  const absent = [...paths].filter((p) => !have.has(p))
  if (absent.length) {
    missing += absent.length
    console.error(`SKIP ${r.id}: ${absent.length} file(s) not in the new store, e.g. ${absent[0]}`)
    continue
  }
  plan.push({ row: r, cols, links: paths.size })
}
console.log(
  `${OLD_HOST} → ${NEW_HOST}: ${plan.length} row(s) to rewrite ` +
    `(${plan.reduce((n, p) => n + p.links, 0)} distinct links), ${rows.length - plan.length} skipped, ${missing} missing file(s)`,
)
if (dry || plan.length === 0) process.exit(missing ? 1 : 0)

const dir = path.join(process.cwd(), '.migration-backup')
mkdirSync(dir, { recursive: true })
const file = path.join(dir, `projects-blob-links-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
writeFileSync(file, JSON.stringify(plan.map((p) => p.row)))
console.log(`backup: ${file}`)

let changed = 0
for (const { row, cols } of plan) {
  for (const c of cols) {
    const res = await sql.query(
      `UPDATE projects SET ${c} = replace(${c}::text, $1, $2)::jsonb WHERE id = $3 AND ${c}::text LIKE $4 RETURNING id`,
      [OLD_HOST, NEW_HOST, row.id, like],
    )
    changed += res.length
  }
}
const left = await sql.query(
  `SELECT count(*)::int AS n FROM projects WHERE ${COLS.map((c) => `${c}::text LIKE $1`).join(' OR ')}`,
  [like],
)
console.log(`updated ${changed} column value(s); rows still linking the old host: ${left[0].n}`)
