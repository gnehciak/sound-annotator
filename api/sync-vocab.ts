// POST|GET /api/sync-vocab?key=… — the "push to the website" button that lives
// in the Notion vocabulary page.
//
// It does not touch the vocabulary itself. Pressing it asks Vercel to rebuild,
// and the build is what reads Notion: `prebuild` runs scripts/sync-vocabulary.mjs
// with the deploy's own NOTION_TOKEN and regenerates src/lib/vocabulary.generated.ts
// before vite runs. So the words ship inside the bundle, the app never talks to
// Notion at runtime, and a Notion outage costs a stale word list rather than an
// empty "@" menu. The trade is a couple of minutes between press and live.
//
// Two verbs because Notion has two kinds of button. A paid workspace's button
// block sends a POST webhook, which is the good one — it stays on the page. A
// plain link block can only GET, so that answers with a small HTML page saying
// what happened, since a browser tab is what the click opened.
//
// Guarded by VOCAB_SYNC_SECRET in the query string rather than a header,
// because a Notion webhook action sends no custom headers and a link block
// certainly cannot. The whole URL is therefore the credential — the same trade
// the guest links make (see api/_lib/guest.ts). Unset means the route refuses
// to run at all rather than leaving a "spend a build" button open to the
// internet; VERCEL_DEPLOY_HOOK_URL is the hook to fire (Vercel project settings
// → Git → Deploy Hooks).
import { err, json } from './_lib/respond.js'

/** Vercel's own deploy-hook host, so a stray env var can't aim this elsewhere. */
const HOOK_ORIGIN = 'https://api.vercel.com'

function page(title: string, detail: string, ok: boolean): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<body style="margin:0;display:grid;place-items:center;min-height:100vh;` +
      `background:#0a0a0c;color:#ececf0;font:15px/1.6 ui-sans-serif,system-ui">` +
      `<div style="max-width:26rem;padding:2rem;text-align:center">` +
      `<div style="font-size:2rem">${ok ? '✅' : '⚠️'}</div>` +
      `<h1 style="font-size:1.05rem;margin:.6rem 0">${title}</h1>` +
      `<p style="color:#9a9aa2;margin:0">${detail}</p></div>`,
    { status: ok ? 200 : 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

async function run(request: Request): Promise<{ ok: boolean; message: string; status: number }> {
  const secret = process.env.VOCAB_SYNC_SECRET
  const hook = process.env.VERCEL_DEPLOY_HOOK_URL
  if (!secret) return { ok: false, status: 503, message: 'VOCAB_SYNC_SECRET is not configured' }
  if (!hook || !hook.startsWith(`${HOOK_ORIGIN}/`))
    return { ok: false, status: 503, message: 'VERCEL_DEPLOY_HOOK_URL is not configured' }

  const key = new URL(request.url).searchParams.get('key')
  // Constant-length compare is overkill for a build trigger, but the check has
  // to reject an absent key as firmly as a wrong one.
  if (!key || key !== secret) return { ok: false, status: 401, message: 'Unauthorized' }

  const res = await fetch(hook, { method: 'POST' })
  if (!res.ok)
    return {
      ok: false,
      status: 502,
      message: `Vercel refused the deploy hook (${res.status})`,
    }
  return {
    ok: true,
    status: 200,
    message: 'Rebuilding Sound Annotator with the current vocabulary. Live in a couple of minutes.',
  }
}

export async function POST(request: Request): Promise<Response> {
  const r = await run(request)
  return r.ok ? json({ ok: true, message: r.message }) : err(r.status, r.message)
}

export async function GET(request: Request): Promise<Response> {
  const r = await run(request)
  return page(
    r.ok ? 'Vocabulary pushed' : 'Could not push the vocabulary',
    r.message,
    r.ok,
  )
}
