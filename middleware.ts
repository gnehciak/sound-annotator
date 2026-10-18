// Routing Middleware (runs before the static files). Its only job: hand an
// `/?embed=` link to api/embed.ts, which serves the same index.html with the
// oEmbed / player-card tags Canva and friends read before they will embed a
// URL. A vercel.json rewrite can't do this — `/` is a static file, and static
// files win over rewrites.
import { next, rewrite } from '@vercel/functions'

export const config = { matcher: '/' }

export default function middleware(request: Request): Response {
  const url = new URL(request.url)
  if (!url.searchParams.get('embed')) return next()
  const dest = new URL('/api/embed', url)
  dest.search = url.search
  dest.searchParams.set('page', '1')
  return rewrite(dest)
}
