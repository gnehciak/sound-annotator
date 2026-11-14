// One-off (Nov 2026): copy everything out of the original Blob store (iad1)
// into the two Sydney stores — the shared media caches (`cache/…`) into the
// private cache store, everything else into the new public store — keeping
// every pathname, so a file's new URL is its old one with the host swapped.
// The database's links are rewritten by scripts/rewrite-blob-host.mjs once
// this has run (and run again after the env switch, for the stragglers).
//
// Re-runnable: a pathname already in its destination at the same size is
// skipped. Nothing is deleted from the old store.
//
//   node --env-file=<pulled production env> scripts/migrate-blob-store.mjs [--dry]
//
// Needs BLOB_READ_WRITE_TOKEN (the old store), BLOB_SYD_READ_WRITE_TOKEN (the
// new public one) and BLOB_CACHE_READ_WRITE_TOKEN (the private cache one).
import { head, list, put } from '@vercel/blob'

const dry = process.argv.includes('--dry')
const OLD = process.env.BLOB_READ_WRITE_TOKEN
const PUB = process.env.BLOB_SYD_READ_WRITE_TOKEN
const PRIV = process.env.BLOB_CACHE_READ_WRITE_TOKEN
if (!OLD || !PUB || !PRIV) throw new Error('Need BLOB_READ_WRITE_TOKEN, BLOB_SYD_READ_WRITE_TOKEN and BLOB_CACHE_READ_WRITE_TOKEN')
if (OLD === PUB) throw new Error('BLOB_READ_WRITE_TOKEN already points at the new store — nothing to copy from')

async function all(token) {
  const out = []
  let cursor
  do {
    const page = await list({ cursor, limit: 1000, token })
    out.push(...page.blobs)
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)
  return out
}

const src = await all(OLD)
const have = new Map()
for (const b of [...(await all(PUB)), ...(await all(PRIV))]) have.set(b.pathname, b.size)

const isCache = (p) => p.startsWith('cache/')
const todo = src.filter((b) => have.get(b.pathname) !== b.size)
const bytes = todo.reduce((n, b) => n + b.size, 0)
console.log(
  `source ${src.length} files; to copy ${todo.length} (${(bytes / 1e6).toFixed(1)} MB): ` +
    `${todo.filter((b) => isCache(b.pathname)).length} to the private cache store, ` +
    `${todo.filter((b) => !isCache(b.pathname)).length} to the public store`,
)
if (dry) process.exit(0)

let done = 0
let failed = 0
const queue = [...todo]
async function worker() {
  for (let b = queue.shift(); b; b = queue.shift()) {
    try {
      const meta = await head(b.url, { token: OLD })
      const res = await fetch(b.url)
      if (!res.ok) throw new Error(`GET ${res.status}`)
      const body = Buffer.from(await res.arrayBuffer())
      if (body.length !== b.size) throw new Error(`size ${body.length} ≠ ${b.size}`)
      const maxAge = /max-age=(\d+)/.exec(meta.cacheControl ?? '')?.[1]
      const cache = isCache(b.pathname)
      await put(b.pathname, body, {
        access: cache ? 'private' : 'public',
        token: cache ? PRIV : PUB,
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: meta.contentType,
        ...(maxAge && !cache ? { cacheControlMaxAge: Number(maxAge) } : {}),
        multipart: body.length > 50e6,
      })
      done++
      if (done % 50 === 0 || done === todo.length) console.log(`${done}/${todo.length}`)
    } catch (e) {
      failed++
      console.error(`FAILED ${b.pathname}: ${e.message}`)
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker))
console.log(`copied ${done}, failed ${failed}`)
process.exit(failed ? 1 : 0)
