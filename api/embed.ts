// Making a `?embed=` link embeddable in Canva, Notion, Slack, etc. (anything
// that unfurls through Iframely or a similar oEmbed consumer).
//
// Those services decide whether a pasted URL can become an iframe by reading
// the page's own HTML: an oEmbed discovery `<link>`, or a Twitter player card.
// The SPA's index.html is static and carries neither, so Canva greyed out
// "Embed". Two verbs on this one function:
//
//   GET /api/embed?page=1&<the embed query>  → index.html with those tags
//       injected into <head>. vercel.json rewrites `/?embed=…` here, so the
//       browser gets the same app and a crawler gets the tags.
//   GET /api/embed?url=<embed link>[&format=json] → the oEmbed response:
//       `type: rich`, an iframe of that link, square.
//
// Nothing here reads more than a title, and only of a track that is already
// readable by link — the clip route enforces the real gate when it plays.
import { getProjectRow } from './_lib/db.js'
import { err, json } from './_lib/respond.js'

/** The embed is a square; this is the size offered to hosts that ask. */
const SIZE = 300

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The title of a link-readable track, or a generic one. */
async function titleFor(id: string | null): Promise<string> {
  if (!id) return 'Audio clip'
  try {
    const row = await getProjectRow(id)
    if (!row || row.deleted_at != null) return 'Audio clip'
    if (!(row.shared || row.editable_by_link || row.published)) return 'Audio clip'
    return row.title ? `${row.title} — clip` : 'Audio clip'
  } catch {
    return 'Audio clip'
  }
}

/** Only our own `?embed=` links get an oEmbed answer. */
function embedLink(raw: string | null, origin: string): URL | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.origin !== origin || !u.searchParams.get('embed')) return null
    return u
  } catch {
    return null
  }
}

export async function GET(request: Request): Promise<Response> {
  const req = new URL(request.url)
  const origin = req.origin

  if (req.searchParams.get('page') === '1') {
    // The address the visitor (or crawler) actually asked for.
    const q = new URLSearchParams(req.searchParams)
    q.delete('page')
    const self = `${origin}/?${q}`
    const title = await titleFor(q.get('embed'))
    const shell = await fetch(`${origin}/index.html`)
    if (!shell.ok) return err(502, 'App shell unavailable')
    const html = await shell.text()
    const oembed = `${origin}/api/embed?url=${encodeURIComponent(self)}&format=json`
    const tags = [
      `<link rel="alternate" type="application/json+oembed" href="${esc(oembed)}" title="${esc(title)}">`,
      `<meta property="og:title" content="${esc(title)}">`,
      `<meta property="og:type" content="video.other">`,
      `<meta property="og:url" content="${esc(self)}">`,
      `<meta property="og:site_name" content="Sound Annotator">`,
      `<meta name="twitter:card" content="player">`,
      `<meta name="twitter:title" content="${esc(title)}">`,
      `<meta name="twitter:player" content="${esc(self)}">`,
      `<meta name="twitter:player:width" content="${SIZE}">`,
      `<meta name="twitter:player:height" content="${SIZE}">`,
    ].join('\n    ')
    return new Response(html.replace('<head>', `<head>\n    ${tags}`), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, s-maxage=300',
      },
    })
  }

  const link = embedLink(req.searchParams.get('url'), origin)
  if (!link) return err(404, 'Not an embed link')
  const fmt = req.searchParams.get('format')
  if (fmt && fmt !== 'json') return err(501, 'Only JSON')
  const title = await titleFor(link.searchParams.get('embed'))
  const src = esc(link.toString())
  return json({
    version: '1.0',
    type: 'rich',
    provider_name: 'Sound Annotator',
    provider_url: origin,
    title,
    width: SIZE,
    height: SIZE,
    html: `<iframe src="${src}" width="${SIZE}" height="${SIZE}" style="border:0;border-radius:16px" allow="autoplay" title="${esc(title)}"></iframe>`,
  })
}
