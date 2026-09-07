// Authentication for the API: who is calling, and what may they do.
//
// The identity provider is us. A caller is signed in because they carry a
// session cookie this server signed (api/_lib/session.ts) after completing a
// Google OAuth round trip (api/auth/[action].ts), and the account directory is
// the `users` table in the same Postgres the projects live in.
//
// That last part is why api/admin/users.ts is now a plain SQL join: accounts
// and projects used to sit in two different stores with nothing but owner_id
// between them, and reconciling the two was the endpoint's whole job.
import { newId } from './ids.js'
import { sql } from './db.js'
import { readSession } from './session.js'

/** The caller's user id, or null when signed out / not configured. */
export async function getUid(request: Request): Promise<string | null> {
  return (await readSession(request))?.sub ?? null
}

/**
 * Is this caller a teacher-admin — allowed to see and manage every project
 * (see api/admin/projects.ts)?
 *
 * Allowlisted by email in `ADMIN_EMAILS` (comma-separated). Email rather than
 * uid because a uid is an implementation detail that has already changed once:
 * it survived the Clerk→first-party move for exactly the same reason it was
 * meant to survive Clerk's dev→production move. The env var is server-only —
 * it never reaches the client bundle, and the client's opinion of who is an
 * admin is never trusted here.
 *
 * Unset ADMIN_EMAILS means nobody is an admin — every admin route 404s for
 * everyone, which is the right default for a feature that can hard-delete
 * other people's work.
 */
export async function isAdmin(uid: string): Promise<boolean> {
  const allowed = adminEmails()
  if (allowed.length === 0) return false
  const email = await emailOf(uid)
  return email != null && allowed.includes(email)
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

async function emailOf(uid: string): Promise<string | null> {
  const rows = (await sql`
    SELECT email FROM users WHERE id = ${uid} LIMIT 1
  `) as unknown as { email: string }[]
  return rows[0]?.email?.toLowerCase() ?? null
}

/** A user's display name, for the byline stamped when a project is published.
 *  Best-effort: a lookup failure publishes as "A teacher" rather than failing
 *  the save. */
export async function getUserName(uid: string): Promise<string> {
  try {
    const rows = (await sql`
      SELECT name, email FROM users WHERE id = ${uid} LIMIT 1
    `) as unknown as { name: string | null; email: string }[]
    const row = rows[0]
    if (!row) return 'A teacher'
    return row.name?.trim() || row.email.split('@')[0] || 'A teacher'
  } catch {
    return 'A teacher'
  }
}

/** One account, as the admin console lists them (api/admin/users.ts). */
export interface AdminUser {
  uid: string
  email: string | null
  name: string | null
  imageUrl: string | null
  createdAt: number | null
  lastSignInAt: number | null
}

/**
 * Every account, newest first — the admin console's user list.
 *
 * No pagination walk anymore: this used to page through Clerk's API because a
 * silently truncated page would tell an admin an account doesn't exist. It's
 * one query now. The cap survives so a runaway signup can't turn the console
 * into an unbounded scan.
 */
export async function listUsers(cap = 500): Promise<AdminUser[]> {
  const rows = (await sql`
    SELECT id, email, name, image_url, created_at, last_sign_in_at
    FROM users
    ORDER BY created_at DESC
    LIMIT ${cap}
  `) as unknown as {
    id: string
    email: string
    name: string | null
    image_url: string | null
    created_at: string | number | null
    last_sign_in_at: string | number | null
  }[]
  return rows.map((r) => ({
    uid: r.id,
    email: r.email,
    name: r.name,
    imageUrl: r.image_url,
    createdAt: r.created_at == null ? null : Number(r.created_at) || null,
    lastSignInAt:
      r.last_sign_in_at == null ? null : Number(r.last_sign_in_at) || null,
  }))
}

/** A Google identity, as the id_token describes it. */
export interface GoogleIdentity {
  sub: string
  email: string
  name: string | null
  picture: string | null
}

/**
 * Resolve a Google identity to an account, creating one on first sign-in.
 *
 * The lookup order is the migration: `google_sub` is the real key, but the
 * accounts seeded from Clerk are matched by verified email too, so the first
 * person to sign in after the cutover lands back on their original uid — and
 * therefore back on their own projects and Blob prefix — rather than getting a
 * fresh, empty account. Email is only ever trusted here because the caller has
 * already proved `email_verified` on a token exchanged with our client secret.
 */
export async function resolveUser(identity: GoogleIdentity): Promise<string> {
  const now = Date.now()
  const { sub, email, name, picture } = identity

  const bySub = (await sql`
    SELECT id FROM users WHERE google_sub = ${sub} LIMIT 1
  `) as unknown as { id: string }[]
  if (bySub[0]) {
    await sql`
      UPDATE users
         SET email = ${email}, name = ${name}, image_url = ${picture},
             last_sign_in_at = ${now}
       WHERE id = ${bySub[0].id}
    `
    return bySub[0].id
  }

  const byEmail = (await sql`
    SELECT id FROM users WHERE lower(email) = ${email.toLowerCase()} LIMIT 1
  `) as unknown as { id: string }[]
  if (byEmail[0]) {
    await sql`
      UPDATE users
         SET google_sub = ${sub}, email = ${email}, name = ${name},
             image_url = ${picture}, last_sign_in_at = ${now}
       WHERE id = ${byEmail[0].id}
    `
    return byEmail[0].id
  }

  const id = newId()
  await sql`
    INSERT INTO users (id, google_sub, email, name, image_url, created_at, last_sign_in_at)
    VALUES (${id}, ${sub}, ${email}, ${name}, ${picture}, ${now}, ${now})
    ON CONFLICT (google_sub) DO UPDATE SET last_sign_in_at = ${now}
  `
  const created = (await sql`
    SELECT id FROM users WHERE google_sub = ${sub} LIMIT 1
  `) as unknown as { id: string }[]
  return created[0]?.id ?? id
}

/** The signed-in user as the client's /api/auth/me sees them. */
export interface MeUser {
  uid: string
  email: string
  displayName: string | null
  photoURL: string | null
  isAdmin: boolean
}

export async function meFor(uid: string): Promise<MeUser | null> {
  const rows = (await sql`
    SELECT id, email, name, image_url FROM users WHERE id = ${uid} LIMIT 1
  `) as unknown as {
    id: string
    email: string
    name: string | null
    image_url: string | null
  }[]
  const row = rows[0]
  if (!row) return null
  const allowed = adminEmails()
  return {
    uid: row.id,
    email: row.email,
    displayName: row.name,
    photoURL: row.image_url,
    isAdmin: allowed.includes(row.email.toLowerCase()),
  }
}
