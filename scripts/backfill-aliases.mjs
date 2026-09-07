// Give every project a short public id.
//
//   node --env-file=.env.local scripts/backfill-aliases.mjs [--commit]
//
// Projects created before short ids have a 36-character uuid primary key, which
// made share links ~69 characters. That key can't simply be replaced: it is
// baked into their Blob paths (users/{owner}/images/{id}/...) and into every
// link already handed to a class. So each row gets an `alias` instead — the
// short id links are built from, while the uuid stays the key and keeps
// resolving forever (api/_lib/db.ts accepts either).
//
// Idempotent: rows that already have an alias are skipped, so re-running is
// safe. Dry-run by default; pass --commit to write.
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)
const commit = process.argv.includes('--commit')

/** 9 random bytes → exactly 12 base64url chars. Mirrors src/lib/ids.ts. */
const newId = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(9)))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')

const rows = await sql`SELECT id, alias, title FROM projects ORDER BY id`
const todo = rows.filter((r) => !r.alias)
console.log(`${rows.length} projects, ${rows.length - todo.length} already aliased, ${todo.length} to do`)
if (todo.length === 0) process.exit(0)

// An alias is resolved with `WHERE id = $1 OR alias = $1`, so it must collide
// with neither column — otherwise one string would name two rows.
const taken = new Set(rows.flatMap((r) => [r.id, r.alias].filter(Boolean)))
const assign = new Map()
for (const r of todo) {
  let a
  do a = newId()
  while (taken.has(a))
  taken.add(a)
  assign.set(r.id, a)
}

for (const r of todo.slice(0, 5))
  console.log(`  ${r.id} -> ${assign.get(r.id)}  ${JSON.stringify(r.title).slice(0, 40)}`)
if (todo.length > 5) console.log(`  … and ${todo.length - 5} more`)

if (!commit) {
  console.log('\nDry run. Re-run with --commit to write.')
  process.exit(0)
}

for (const [id, alias] of assign) {
  // `alias IS NULL` makes each write idempotent even if two runs overlap.
  await sql`UPDATE projects SET alias = ${alias} WHERE id = ${id} AND alias IS NULL`
}
// Count from the table, not from the loop: an UPDATE without RETURNING comes
// back as an empty array, so counting its rows would always report zero.
const [{ n: done }] = await sql`SELECT count(*)::int AS n FROM projects WHERE alias IS NOT NULL`
const left = await sql`SELECT count(*)::int AS n FROM projects WHERE alias IS NULL`
console.log(`\n${done} projects now have an alias. Rows still without one: ${left[0].n}`)
