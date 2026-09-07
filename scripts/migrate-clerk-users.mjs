// One-time seed of the `users` table from the Clerk instance we left behind.
// Usage: node --env-file=.env.local scripts/migrate-clerk-users.mjs [--apply]
//
// Why this exists at all: `users.id` has to keep being the Clerk `user_…` id.
// That string is written into every projects.owner_id, every folders.owner_id,
// and every Blob path (users/{owner_id}/images/{projectId}/…). Minting fresh
// ids at the cutover would have left every existing project owned by an
// account that no longer exists, with its note images stranded under a prefix
// nothing points at any more.
//
// So each Clerk account is copied across verbatim — its id, its Google `sub`,
// its verified email — and first-party sign-in then resolves a Google identity
// back onto that same row (api/_lib/auth.ts, resolveUser). The teacher signs in
// with the same Google account they always did and finds their tracks exactly
// where they left them.
//
// Avatars are deliberately not copied: Clerk's img.clerk.com URLs die with the
// instance. image_url fills itself from Google's `picture` claim the first time
// each person signs in.
//
// Dry by default — prints what it would write. Pass --apply to commit.
import { neon } from '@neondatabase/serverless'

const apply = process.argv.includes('--apply')
const secret = process.env.CLERK_SECRET_KEY
const url = process.env.DATABASE_URL

if (!url) {
  console.error('DATABASE_URL is not set (run with --env-file=.env.local)')
  process.exit(1)
}
if (!secret) {
  console.error('CLERK_SECRET_KEY is not set — needed to read the old accounts')
  process.exit(1)
}

const sql = neon(url)

/** Every Clerk account, walking pages so a big instance can't truncate. */
async function clerkUsers() {
  const out = []
  for (let offset = 0; ; offset += 100) {
    const res = await fetch(
      // Oldest first. Not `+created_at`: the `+` decodes to a space in a query
      // string and Clerk rejects it — ascending is the default anyway.
      `https://api.clerk.com/v1/users?limit=100&offset=${offset}&order_by=created_at`,
      { headers: { Authorization: `Bearer ${secret}` } },
    )
    if (!res.ok) throw new Error(`Clerk API ${res.status}: ${await res.text()}`)
    const page = await res.json()
    if (!Array.isArray(page) || page.length === 0) return out
    out.push(...page)
    if (page.length < 100) return out
  }
}

const users = await clerkUsers()
console.log(`Clerk accounts: ${users.length}`)

const rows = []
for (const u of users) {
  // The primary address, falling back to the first on file. Clerk marks the
  // primary with primary_email_address_id.
  const email =
    u.email_addresses?.find((e) => e.id === u.primary_email_address_id) ??
    u.email_addresses?.[0]
  const google = (u.external_accounts ?? []).find(
    (a) => a.provider === 'oauth_google' || a.provider === 'google',
  )
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ') || u.username || null

  if (!email?.email_address) {
    console.warn(`  SKIP ${u.id} — no email address on the account`)
    continue
  }
  // A password-only account can't sign in after the cutover, so say so loudly
  // rather than seeding a row nobody can ever reach.
  if (!google) {
    console.warn(
      `  WARN ${u.id} <${email.email_address}> has no Google identity — ` +
        `seeded by email only; they must sign in with a Google account on that address`,
    )
  }
  rows.push({
    id: u.id,
    sub: google?.provider_user_id ?? null,
    email: email.email_address,
    name,
    createdAt: u.created_at ?? 0,
    lastSignInAt: u.last_sign_in_at ?? null,
  })
}

// How many projects each account owns — the number that would be orphaned if
// this seed were skipped. Printed so the dry run is checkable at a glance.
const counts = new Map(
  (
    await sql`SELECT owner_id, count(*)::int AS n FROM projects GROUP BY owner_id`
  ).map((r) => [r.owner_id, r.n]),
)

for (const r of rows) {
  console.log(
    `  ${r.id}  ${r.email}  sub:${r.sub ?? 'none'}  projects:${counts.get(r.id) ?? 0}`,
  )
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to write these rows.')
  process.exit(0)
}

for (const r of rows) {
  // Idempotent: re-running must not clobber a google_sub or last_sign_in_at
  // that a real sign-in has since written. COALESCE keeps whatever is newer,
  // so this is safe to run again after the cutover has started.
  await sql`
    INSERT INTO users (id, google_sub, email, name, created_at, last_sign_in_at)
    VALUES (${r.id}, ${r.sub}, ${r.email}, ${r.name}, ${r.createdAt}, ${r.lastSignInAt})
    ON CONFLICT (id) DO UPDATE
      SET google_sub = COALESCE(users.google_sub, EXCLUDED.google_sub),
          email      = EXCLUDED.email,
          name       = COALESCE(users.name, EXCLUDED.name)
  `
}

const seeded = await sql`SELECT count(*)::int AS n FROM users`
console.log(`\nApplied. users table now holds ${seeded[0].n} rows.`)

// The check that actually matters: can every signed-in project still name its
// owner? Guest rows own themselves and are expected to have no account.
const orphans = await sql`
  SELECT DISTINCT p.owner_id
  FROM projects p LEFT JOIN users u ON u.id = p.owner_id
  WHERE u.id IS NULL AND p.owner_id NOT LIKE 'guest:%'
`
if (orphans.length === 0) console.log('Every non-guest project has an account. ✓')
else {
  console.error('ORPHANED owner_ids (no account row):')
  for (const o of orphans) console.error(`  ${o.owner_id}`)
  process.exitCode = 1
}
