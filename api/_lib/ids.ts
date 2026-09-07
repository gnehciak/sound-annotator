// Server-side twin of src/lib/ids.ts. The /api functions compile against their
// own tsconfig and never import from src/, so the one function the server
// needs lives here rather than being shared across that boundary.
//
// Only new accounts use this (api/_lib/auth.ts). Accounts migrated off Clerk
// keep their original `user_…` id — see the comment on the users table in
// scripts/schema.sql for why that isn't negotiable.

/** 9 random bytes as 12 base64url characters. See src/lib/ids.ts for the
 *  reasoning about length and guessability. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return Buffer.from(bytes).toString('base64url')
}
