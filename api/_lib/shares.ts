// Per-person sharing: the `project_shares` table and the one question every
// foreign request asks of it — "what may this caller do here?"
//
// Keyed by email, not uid, because an invite is written before the invitee has
// necessarily signed in (and, like ADMIN_EMAILS, it then survives a Clerk
// instance move that mints new uids). The two roles map onto powers this API
// already had, rather than inventing a third kind of caller:
//
//   viewer → exactly a `?view=` link holder: GET only.
//   editor → exactly a link editor: content fields only (title, annotations,
//            updatedAt), still serialized by the edit lock. Never sharing,
//            ownership, source or settings.
//
// So a project's access is the union of two independent things: what the link
// grants everyone who holds it, and what a named person is granted on top. A
// view-only link plus an editor invite is the normal shape — the link is the
// classroom, the invite is the colleague.
import { sql } from './db.js'
import { getUserEmail } from './auth.js'

export type ShareRole = 'viewer' | 'editor'

export interface ShareRow {
  project_id: string
  email: string
  role: string
  invited_at: string | number
}

/** The stored form of an address: trimmed and lowercased, both sides of every
 *  comparison. Case is not identity in email, and a teacher typing
 *  "Sam@School.edu" must not create a second, silently powerless row. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const e = raw.trim().toLowerCase()
  // Deliberately loose: this is a lookup key we compare against the verified
  // address Google gave us, never something we deliver mail to, so the only real
  // requirement is that it can't be blank or a whole list smuggled into one
  // field. Rejecting valid-but-unusual addresses would lock people out for
  // the sake of a regex.
  if (e.length < 3 || e.length > 320) return null
  if (!/^[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+$/.test(e)) return null
  return e
}

export function asRole(raw: unknown): ShareRole {
  return raw === 'editor' ? 'editor' : 'viewer'
}

/**
 * What this signed-in caller may do on this project by invitation, or null if
 * they were never invited. `projectId` must be the row's real id (never an
 * alias) — callers canonicalize through getProjectRow first, exactly as the
 * Blob paths do.
 */
export async function shareRoleFor(
  projectId: string,
  uid: string | null,
): Promise<ShareRole | null> {
  if (!uid) return null
  const email = await getUserEmail(uid)
  if (!email) return null
  const rows = (await sql`
    SELECT role FROM project_shares
    WHERE project_id = ${projectId} AND email = ${email}
    LIMIT 1
  `) as { role: string }[]
  if (rows.length === 0) return null
  return asRole(rows[0].role)
}

/** Everyone invited to a project, oldest invite first — the owner's list. */
export async function listShares(projectId: string): Promise<ShareRow[]> {
  return (await sql`
    SELECT project_id, email, role, invited_at FROM project_shares
    WHERE project_id = ${projectId}
    ORDER BY invited_at ASC, email ASC
  `) as ShareRow[]
}

export function shareToJson(r: ShareRow): Record<string, unknown> {
  return {
    email: r.email,
    role: asRole(r.role),
    invitedAt: Number(r.invited_at) || 0,
  }
}
