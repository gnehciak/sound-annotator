// The session itself: a signed JWT in an httpOnly cookie, and the short-lived
// cookie that carries OAuth state across the round trip to Google.
//
// Clerk used to own this. What replaced it is deliberately small — one secret
// (`AUTH_SECRET`), one cookie, no server-side session store. A session is
// valid because we signed it, so verifying one is a local HMAC check rather
// than a network call to an identity provider, which is why getUid() no longer
// costs a round trip on every single API request.
//
// The trade is that a session can't be revoked from the server before it
// expires. At this app's scale that's the right trade: signing out clears the
// cookie, the lifetime is 30 days, and rotating AUTH_SECRET invalidates every
// session at once if one ever needs to be pulled.
import { SignJWT, jwtVerify } from 'jose'

/** The signed-in session. Read by api/_lib/auth.ts on every request. */
export const SESSION_COOKIE = 'sa_session'
/** In-flight OAuth: PKCE verifier + state, alive only across the redirect. */
export const OAUTH_COOKIE = 'sa_oauth'

const SESSION_SECONDS = 30 * 24 * 60 * 60
const OAUTH_SECONDS = 10 * 60

/** What rides inside the session cookie. */
export interface SessionClaims {
  /** users.id — the app's principal, and what owner_id is compared against. */
  sub: string
  /** Google's verified address. Carried in the token so the ADMIN_EMAILS check
   *  doesn't need a database read on every admin request; it is as trustworthy
   *  as `sub`, since we signed both. */
  email: string
}

/** What rides inside the OAuth cookie, for the ten minutes it exists. */
export interface OAuthClaims {
  state: string
  verifier: string
  /** Where to land the user once they're signed in — always a same-origin
   *  path, validated at both ends (see safeNext). */
  next: string
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(s)
}

/** True once sign-in can actually work — mirrors the old "is Clerk configured"
 *  check, so a misconfigured deploy shows the setup notice instead of a
 *  sign-in button that leads nowhere. */
export function authConfigured(): boolean {
  return Boolean(
    process.env.AUTH_SECRET &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET,
  )
}

async function sign(payload: object, seconds: number): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(secret())
}

export function signSession(claims: SessionClaims): Promise<string> {
  return sign(claims, SESSION_SECONDS)
}

export function signOAuth(claims: OAuthClaims): Promise<string> {
  return sign(claims, OAUTH_SECONDS)
}

/** The caller's session, or null when absent, expired or tampered with. */
export async function readSession(request: Request): Promise<SessionClaims | null> {
  if (!process.env.AUTH_SECRET) return null
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    const sub = payload.sub ?? (payload as { sub?: unknown }).sub
    const email = (payload as { email?: unknown }).email
    if (typeof sub !== 'string' || typeof email !== 'string') return null
    return { sub, email }
  } catch {
    return null
  }
}

export async function readOAuth(request: Request): Promise<OAuthClaims | null> {
  const token = readCookie(request, OAUTH_COOKIE)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    const { state, verifier, next } = payload as Record<string, unknown>
    if (typeof state !== 'string' || typeof verifier !== 'string') return null
    return { state, verifier, next: typeof next === 'string' ? next : '/' }
  } catch {
    return null
  }
}

/** One cookie's value out of the request, or null. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

/**
 * A Set-Cookie value.
 *
 * SameSite=Lax is what stands in for a CSRF token here: it keeps the cookie off
 * every cross-site POST/DELETE while still sending it on the top-level GET
 * navigation that returns from Google. That only holds because no state-
 * changing route in /api is a GET — the mutating verbs on
 * api/projects/[id]/index.ts are POST/PATCH/DELETE, including ?restore=1 and
 * ?purge=1. Keep it that way, or this becomes a hole.
 *
 * `Secure` is dropped on plain-http localhost only, or the cookie would be
 * silently discarded during `npm run dev:full`.
 */
export function setCookie(
  name: string,
  value: string,
  { seconds, secure }: { seconds: number; secure: boolean },
): string {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${seconds}`,
  ]
  if (secure) bits.push('Secure')
  return bits.join('; ')
}

export function clearCookie(name: string, secure: boolean): string {
  return setCookie(name, '', { seconds: 0, secure })
}

export const sessionMaxAge = SESSION_SECONDS
export const oauthMaxAge = OAUTH_SECONDS

/**
 * The public origin this request arrived on.
 *
 * Behind Vercel's proxy the function sees an internal host, so the forwarded
 * headers are the truth — and the redirect_uri built from this has to match
 * what's registered in the Google console *byte for byte*, or the exchange
 * fails. `AUTH_ORIGIN` overrides both, which is the escape hatch for preview
 * deployments (whose hostnames change every push and so can never be
 * pre-registered with Google).
 */
export function originOf(request: Request): string {
  const override = process.env.AUTH_ORIGIN
  if (override) return override.replace(/\/+$/, '')
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  if (!host) return new URL(request.url).origin
  const proto =
    request.headers.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}

export function isSecureOrigin(origin: string): boolean {
  return origin.startsWith('https://')
}

/**
 * Sanitise the post-sign-in destination.
 *
 * `next` arrives from the query string, so without this the sign-in route
 * would be an open redirector: `?next=https://evil.example` would send a
 * freshly-authenticated user off-site. Only a same-origin absolute path is
 * allowed — and `//host` is rejected too, since a browser reads that as
 * protocol-relative and leaves the site.
 */
export function safeNext(raw: string | null): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  return raw
}
