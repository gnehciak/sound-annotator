// Sign-in. Four actions on one function, dispatched off the [action] segment:
//
//   GET  /api/auth/google    → redirect to Google (starts the flow)
//   GET  /api/auth/callback  → Google returns here; mints the session cookie
//   GET  /api/auth/me        → who is signed in (the client's boot call)
//   POST /api/auth/signout   → clears the session cookie
//
// This is OAuth 2.0 Authorization Code with PKCE against Google directly —
// no identity provider in between. The app asks for `openid email profile`
// and nothing else: all three are non-sensitive scopes, which is what lets the
// consent screen be published without waiting on a Google review, and what
// keeps the token exchange this short.
//
// Two things guard the round trip. `state` is a random value echoed back by
// Google and compared against a signed, httpOnly cookie — an attacker can't
// forge a callback for a flow they didn't start (CSRF on the login itself).
// The PKCE `code_verifier` means a stolen authorization code is useless
// without the cookie that started the flow. Both live in one short-lived
// cookie that is cleared the moment the callback runs, win or lose.
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { resolveUser, meFor, type GoogleIdentity } from '../_lib/auth.js'
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  authConfigured,
  clearCookie,
  isSecureOrigin,
  oauthMaxAge,
  originOf,
  readOAuth,
  readSession,
  safeNext,
  sessionMaxAge,
  setCookie,
  signOAuth,
  signSession,
} from '../_lib/session.js'
import { json, err } from '../_lib/respond.js'

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
// Google signs id_tokens with either spelling of the issuer.
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']

// Module scope, so a warm function reuses the fetched key set instead of
// pulling Google's certs on every single sign-in.
const jwks = createRemoteJWKSet(new URL(JWKS_URL))

function actionOf(request: Request): string {
  const path = new URL(request.url).pathname.replace(/\/+$/, '')
  return path.slice(path.lastIndexOf('/') + 1)
}

export async function GET(request: Request): Promise<Response> {
  switch (actionOf(request)) {
    case 'me':
      return me(request)
    case 'google':
      return start(request)
    case 'callback':
      return callback(request)
    default:
      return err(404, 'Not found')
  }
}

export async function POST(request: Request): Promise<Response> {
  if (actionOf(request) !== 'signout') return err(404, 'Not found')
  const secure = isSecureOrigin(originOf(request))
  return new Response(JSON.stringify({ user: null }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookie(SESSION_COOKIE, secure),
    },
  })
}

/**
 * Who is signed in.
 *
 * `configured` is what the client's setup notice keys off (src/lib/api.ts):
 * without it a deploy missing GOOGLE_CLIENT_ID would render a perfectly normal
 * sign-in button that silently leads nowhere.
 */
async function me(request: Request): Promise<Response> {
  const configured = authConfigured()
  const session = await readSession(request)
  if (!session) return json({ configured, user: null })
  // The row, not the token: a name or avatar changed since sign-in should
  // show, and an account deleted underneath a live cookie must read as
  // signed out rather than as a ghost.
  const user = await meFor(session.sub)
  return json({ configured, user })
}

/** Step one: bounce the visitor to Google, remembering how to finish. */
async function start(request: Request): Promise<Response> {
  if (!authConfigured()) return err(503, 'Sign-in is not configured')
  const origin = originOf(request)
  const next = safeNext(new URL(request.url).searchParams.get('next'))

  const state = randomToken(16)
  const verifier = randomToken(48)
  const challenge = await s256(verifier)

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: `${origin}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    // No refresh token: the session is ours and Google is only ever consulted
    // at sign-in, so there is nothing to refresh and nothing to store.
    access_type: 'online',
    // Teachers share machines with other teachers; always let them pick which
    // account rather than silently reusing whichever Google session is live.
    prompt: 'select_account',
  })

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${AUTH_ENDPOINT}?${params}`,
      'Set-Cookie': setCookie(
        OAUTH_COOKIE,
        await signOAuth({ state, verifier, next }),
        { seconds: oauthMaxAge, secure: isSecureOrigin(origin) },
      ),
      'Cache-Control': 'no-store',
    },
  })
}

/** Step two: Google sends the visitor back here with a code. */
async function callback(request: Request): Promise<Response> {
  const origin = originOf(request)
  const secure = isSecureOrigin(origin)
  const url = new URL(request.url)
  // Whatever happens next, this flow is over — the state/verifier pair must
  // never survive to be replayed.
  const drop = clearCookie(OAUTH_COOKIE, secure)

  const pending = await readOAuth(request)
  const denied = url.searchParams.get('error')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  if (denied) return bounce(signInError('cancelled', pending?.next), drop)
  if (!pending || !code || !state || state !== pending.state)
    return bounce(signInError('state', pending?.next), drop)

  let identity: GoogleIdentity
  try {
    identity = await exchange(code, pending.verifier, `${origin}/api/auth/callback`)
  } catch {
    return bounce(signInError('exchange', pending.next), drop)
  }

  const uid = await resolveUser(identity)
  const session = await signSession({ sub: uid, email: identity.email })

  return new Response(null, {
    status: 302,
    headers: [
      ['Location', pending.next],
      ['Cache-Control', 'no-store'],
      ['Set-Cookie', drop],
      [
        'Set-Cookie',
        setCookie(SESSION_COOKIE, session, { seconds: sessionMaxAge, secure }),
      ],
    ],
  })
}

/**
 * Trade the authorization code for an id_token, and read the identity out of
 * it.
 *
 * The signature is verified against Google's published keys even though the
 * token arrived over TLS from Google's own endpoint (OIDC §3.1.3.7 permits
 * skipping it). Verification is one cached JWKS fetch, and it is what makes
 * the `aud`/`iss`/`exp` checks below mean something rather than being a
 * restatement of what the response body claimed about itself.
 */
async function exchange(
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<GoogleIdentity> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`)
  const body = (await res.json()) as { id_token?: string }
  if (!body.id_token) throw new Error('No id_token in token response')

  const { payload } = await jwtVerify(body.id_token, jwks, {
    issuer: ISSUERS,
    audience: process.env.GOOGLE_CLIENT_ID as string,
  })
  const sub = payload.sub
  const email = payload.email as string | undefined
  // An unverified address must never match an existing account by email —
  // that is precisely the door the Clerk migration path opens, so shut it here.
  if (payload.email_verified !== true) throw new Error('Email is not verified')
  if (typeof sub !== 'string' || !email) throw new Error('Incomplete id_token')

  return {
    sub,
    email,
    name: typeof payload.name === 'string' ? payload.name : null,
    picture: typeof payload.picture === 'string' ? payload.picture : null,
  }
}

/** Send the visitor back into the app with the failure in the URL, rather than
 *  stranding them on a bare API error page mid-sign-in. */
function signInError(reason: string, next: string | undefined): string {
  const target = safeNext(next ?? '/')
  const sep = target.includes('?') ? '&' : '?'
  return `${target}${sep}auth_error=${encodeURIComponent(reason)}`
}

function bounce(location: string, dropCookie: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      'Set-Cookie': dropCookie,
      'Cache-Control': 'no-store',
    },
  })
}

function randomToken(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    'base64url',
  )
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  )
  return Buffer.from(digest).toString('base64url')
}
