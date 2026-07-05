// Tiny response helpers for the Web-signature Vercel Functions in /api.

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function err(status: number, message: string): Response {
  return json({ error: message }, status)
}
