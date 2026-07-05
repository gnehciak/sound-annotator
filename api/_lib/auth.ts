// Clerk authentication for the API. Resolves the caller's user id from either
// the Authorization: Bearer header (what src/lib/api.ts sends) or Clerk's
// same-origin session cookie (what @vercel/blob/client's token request rides
// on, since it doesn't carry custom headers).
import { createClerkClient, type ClerkClient } from '@clerk/backend'

let clerk: ClerkClient | null = null

/** The caller's Clerk user id, or null when signed out / not configured. */
export async function getUid(request: Request): Promise<string | null> {
  if (!process.env.CLERK_SECRET_KEY) return null
  clerk ??= createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    // The Vercel marketplace integration provisions the publishable key under
    // its Next.js name; accept either.
    publishableKey:
      process.env.CLERK_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  })
  try {
    const state = await clerk.authenticateRequest(request)
    return state.toAuth()?.userId ?? null
  } catch {
    return null
  }
}
