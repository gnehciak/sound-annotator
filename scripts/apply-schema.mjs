// Apply scripts/schema.sql to the Neon database in DATABASE_URL.
// Usage: node --env-file=.env.local scripts/apply-schema.mjs
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set (run with --env-file=.env.local)')
  process.exit(1)
}

const sql = neon(url)
const ddl = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

// neon() runs one statement per call. Drop comment lines first (they may
// contain semicolons), then split the remaining DDL on statement boundaries.
const statements = ddl
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)

for (const stmt of statements) {
  await sql.query(stmt)
}

const tables = await sql.query(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' ORDER BY table_name`,
)
console.log('Schema applied. Tables:', tables.map((r) => r.table_name).join(', '))
