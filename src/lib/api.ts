// Fetch helper for the /api Vercel Functions.
//
// There is no token to attach anymore. The session is an httpOnly cookie the
// server signed (api/_lib/session.ts), so it rides along with every same-origin
// request the browser makes — including the ones this module can't reach, like
// @vercel/blob/client's own fetch and the keepalive lock release fired from
// `pagehide`. That deleted a whole layer here: no token getter to register, no
// last-token cache to keep warm, no bridge component under a provider.
//
// The cookie is httpOnly, so JS can't read it: "am I signed in?" is answered by
// GET /api/auth/me (see lib/auth.tsx), never by inspecting document.cookie.

/** The guest project key, when a signed-out student is editing (lib/guest.ts).
 *  Sent as a header; the server ignores it whenever a real session cookie is
 *  present, so a signed-in teacher opening a guest link stays themselves. */
let guestKey: string | null = null

export function registerGuestKey(key: string | null): void {
  guestKey = key
}

/**
 * The live guest key, for the one caller that can't go through `api()`:
 * @vercel/blob/client requests its upload token with its own fetch and carries
 * no custom headers, so the key has to travel in that SDK's `clientPayload`
 * instead of the X-Guest-Key header (see src/lib/imageCloud.ts).
 */
export function currentGuestKey(): string | null {
  return guestKey
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * JSON round-trip to an /api route. Pass a body via `json`; throws ApiError
 * (with the HTTP status) on any non-2xx response.
 */
export async function api<T>(
  path: string,
  init?: Omit<RequestInit, 'body'> & { json?: unknown },
): Promise<T> {
  const headers = new Headers(init?.headers)
  if (guestKey) headers.set('X-Guest-Key', guestKey)
  let body: BodyInit | undefined
  if (init?.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(path, { ...init, headers, body })
  if (!res.ok) {
    const message = await res
      .json()
      .then((d: { error?: string }) => d.error ?? res.statusText)
      .catch(() => res.statusText)
    throw new ApiError(res.status, message)
  }
  return res.json() as Promise<T>
}
