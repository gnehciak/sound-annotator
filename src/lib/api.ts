// Fetch helper for the /api Vercel Functions. Attaches the Clerk session
// token when one is available; ApiTokenBridge (main.tsx) registers the getter
// once Clerk loads, so every caller — signed-in app and share viewer alike —
// goes through the same door.

/** False until the Clerk publishable key is configured (see .env.local). */
export const backendReady = Boolean(
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined,
)

type TokenGetter = () => Promise<string | null>

let getToken: TokenGetter | null = null

/** The most recent token, kept for fire-and-forget calls (pagehide release)
 *  that can't await — best-effort by nature, the lock TTL covers failure. */
export let lastToken: string | null = null

export function registerTokenGetter(fn: TokenGetter | null): void {
  getToken = fn
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
  const token = (await getToken?.()) ?? null
  if (token) {
    lastToken = token
    headers.set('Authorization', `Bearer ${token}`)
  }
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
