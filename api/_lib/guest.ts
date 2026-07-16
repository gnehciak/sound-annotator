// Guest projects — capability tokens for students who never sign in.
//
// The whole model: a guest project's URL *is* its credential. Creating one
// mints a random key, returned to the client exactly once and never again;
// only its SHA-256 lands in the database, so a leaked dump doesn't hand
// anyone edit rights (the same reason we don't store passwords in the clear).
//
// Guest rows are owned by `guest:<uuid>` — a synthetic owner that can never
// collide with a Clerk uid (`user_…`), so every owner-scoped query in the API
// keeps ignoring them for free. A guest may only ever touch content fields;
// sharing, publishing, and ownership stay out of reach (see
// projects/[id]/index.ts).
import { sql } from './db.js'

const GUEST_OWNER_PREFIX = 'guest:'

/**
 * Signed-out creation is rate-limited per IP, because there is no account to
 * limit instead. Sized deliberately loose: a school NATs an entire cohort
 * behind ONE address, so a class of thirty is a single IP making thirty
 * creates in a lesson. The cap has to miss that and still catch a script,
 * which does thousands — hence 60/hour rather than the single digits a
 * per-user limit would use.
 */
const QUOTA_WINDOW_MS = 60 * 60 * 1000
const QUOTA_MAX_PER_WINDOW = 60

/** A fresh synthetic owner id for a guest project. */
export function newGuestOwnerId(): string {
  return `${GUEST_OWNER_PREFIX}${crypto.randomUUID()}`
}

export function isGuestOwner(ownerId: string): boolean {
  return ownerId.startsWith(GUEST_OWNER_PREFIX)
}

/** 32 bytes of CSPRNG, base64url — the key that rides in the student's URL. */
export function mintGuestKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashGuestKey(key: string): Promise<string> {
  return sha256Hex(key)
}

/**
 * Claim one signed-out create against the caller's IP quota; false means they
 * are over it. The counter is read-modify-written in a single atomic upsert —
 * two simultaneous creates from one classroom must not both read the old count
 * and each write count+1, which is how a limiter silently becomes a no-op.
 */
export async function takeGuestCreateSlot(request: Request): Promise<boolean> {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  const ipHash = await sha256Hex(ip)
  const now = Date.now()
  const expired = now - QUOTA_WINDOW_MS
  const rows = (await sql`
    INSERT INTO guest_quota (ip_hash, window_start, count)
    VALUES (${ipHash}, ${now}, 1)
    ON CONFLICT (ip_hash) DO UPDATE SET
      window_start =
        CASE WHEN guest_quota.window_start < ${expired}
             THEN ${now} ELSE guest_quota.window_start END,
      count =
        CASE WHEN guest_quota.window_start < ${expired}
             THEN 1 ELSE guest_quota.count + 1 END
    RETURNING count
  `) as { count: number }[]
  return (rows[0]?.count ?? 0) <= QUOTA_MAX_PER_WINDOW
}

/** The key the client sends alongside a guest write (src/lib/api.ts). */
export function guestKeyFrom(request: Request): string | null {
  const key = request.headers.get('x-guest-key')
  return key && key.length >= 20 ? key : null
}

/**
 * Does `key` open `row.guest_token_hash`? Compared in constant time: a
 * length-or-content early return would leak the hash a byte at a time to
 * anyone willing to time the endpoint.
 */
export async function guestKeyOpens(
  key: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false
  const candidate = await hashGuestKey(key)
  if (candidate.length !== storedHash.length) return false
  let diff = 0
  for (let i = 0; i < candidate.length; i++)
    diff |= candidate.charCodeAt(i) ^ storedHash.charCodeAt(i)
  return diff === 0
}
