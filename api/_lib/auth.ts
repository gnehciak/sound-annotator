// Clerk authentication for the API. Resolves the caller's user id from either
// the Authorization: Bearer header (what src/lib/api.ts sends) or Clerk's
// same-origin session cookie (what @vercel/blob/client's token request rides
// on, since it doesn't carry custom headers).
import { createClerkClient, type ClerkClient } from '@clerk/backend'

let clerk: ClerkClient | null = null

function client(): ClerkClient {
  clerk ??= createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    // The Vercel marketplace integration provisions the publishable key under
    // its Next.js name; accept either.
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  })
  return clerk
}

/** The caller's Clerk user id, or null when signed out / not configured. */
export async function getUid(request: Request): Promise<string | null> {
  if (!process.env.CLERK_SECRET_KEY) return null
  try {
    const state = await client().authenticateRequest(request)
    return state.toAuth()?.userId ?? null
  } catch {
    return null
  }
}

/**
 * Is this caller a teacher-admin — allowed to see and manage every guest
 * project (see api/admin/guests.ts)?
 *
 * Allowlisted by email in `ADMIN_EMAILS` (comma-separated). Email rather than
 * uid so it survives the dev→production instance move, which mints new uids
 * and would otherwise silently lock the admin out of their own page. The env
 * var is deliberately server-only: it never reaches the client bundle, and the
 * client's opinion of who is an admin is never trusted here.
 *
 * Unset ADMIN_EMAILS means nobody is an admin — the page 404s for everyone,
 * which is the right default for a feature that can delete other people's work.
 */
export async function isAdmin(uid: string): Promise<boolean> {
  const allowed = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.length === 0) return false
  try {
    const u = await client().users.getUser(uid)
    const email = u.primaryEmailAddress?.emailAddress?.toLowerCase()
    return email != null && allowed.includes(email)
  } catch {
    return false
  }
}

/** A user's display name, for the byline stamped when a project is published.
 *  Best-effort: a lookup failure publishes as "A teacher" rather than failing
 *  the save. */
export async function getUserName(uid: string): Promise<string> {
  try {
    const u = await client().users.getUser(uid)
    const full = [u.firstName, u.lastName].filter(Boolean).join(' ')
    return full || u.username || 'A teacher'
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
 * Clerk paginates, so this walks pages rather than trusting one call to return
 * everyone: a silently truncated list would tell an admin an account doesn't
 * exist. Capped so a runaway signup never turns this into an unbounded scan.
 */
export async function listUsers(cap = 500): Promise<AdminUser[]> {
  if (!process.env.CLERK_SECRET_KEY) return []
  const out: AdminUser[] = []
  const pageSize = 100
  for (let offset = 0; offset < cap; offset += pageSize) {
    const page = await client().users.getUserList({
      limit: Math.min(pageSize, cap - offset),
      offset,
      orderBy: '-created_at',
    })
    // The SDK moved from returning a bare array to { data, totalCount };
    // accept either so a minor bump can't empty this page.
    const users = Array.isArray(page) ? page : page.data
    if (!users || users.length === 0) break
    for (const u of users) {
      const full = [u.firstName, u.lastName].filter(Boolean).join(' ')
      out.push({
        uid: u.id,
        email: u.primaryEmailAddress?.emailAddress ?? null,
        name: full || u.username || null,
        imageUrl: u.imageUrl ?? null,
        createdAt: u.createdAt ?? null,
        lastSignInAt: u.lastSignInAt ?? null,
      })
    }
    if (users.length < pageSize) break
  }
  return out
}
