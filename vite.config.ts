import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const SCHEMA_DOC = '/track-schema.md'

/** Where pdf.js's wasm decoders are served from — see src/lib/pdf.ts. */
const PDF_WASM_DIR = '/pdf-wasm/'

/**
 * Serve the published track-file schema as UTF-8 plain text in dev, matching
 * the header vercel.json sets in production. Vite's static handler answers
 * `text/markdown` with no charset, the browser falls back to latin-1, and every
 * em dash in the doc renders as mojibake — so this answers the request itself
 * rather than setting a header the static handler would overwrite.
 */
function schemaDocAsText(): Plugin {
  return {
    name: 'track-schema-content-type',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== SCHEMA_DOC) return next()
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.end(readFileSync(`public${SCHEMA_DOC}`))
      })
    },
  }
}

/**
 * Publish pdf.js's wasm decoders at {@link PDF_WASM_DIR}.
 *
 * pdf.js draws a *scanned* page — CCITT fax, JBIG2, JPEG 2000, which is most
 * of IMSLP — through a wasm module it fetches at run time from the `wasmUrl`
 * it was given, and it ships those modules as loose files in
 * `pdfjs-dist/wasm/`. Nothing imports them, so a bundler never sees them:
 * without this they simply aren't in the deployment, the decoder fails to
 * initialise, and pdf.js drops the image and paints the page's white
 * background — a blank sheet of exactly the right shape, with no error
 * anywhere. See src/lib/pdf.ts, which passes the URL.
 *
 * The whole directory is copied rather than a list of the files we think we
 * need: an allowlist that misses a decoder a future pdf.js adds would bring
 * that silence straight back. `fileName` rather than `name` keeps the exact
 * spellings, which is the whole contract — pdf.js concatenates them onto the
 * URL, so a content hash would be a 404.
 */
function pdfWasmAssets(): Plugin {
  const require = createRequire(import.meta.url)
  const dir = join(require.resolve('pdfjs-dist/package.json'), '..', 'wasm')
  const files = () => readdirSync(dir)
  return {
    name: 'pdfjs-wasm-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0]
        if (!path?.startsWith(PDF_WASM_DIR)) return next()
        const name = path.slice(PDF_WASM_DIR.length)
        if (!files().includes(name)) return next()
        res.setHeader(
          'Content-Type',
          extname(name) === '.wasm'
            ? 'application/wasm'
            : extname(name) === '.js'
              ? 'text/javascript'
              : 'text/plain; charset=utf-8',
        )
        res.end(readFileSync(join(dir, name)))
      })
    },
    generateBundle() {
      for (const name of files())
        this.emitFile({
          type: 'asset',
          fileName: `${PDF_WASM_DIR.slice(1)}${name}`,
          source: readFileSync(join(dir, name)),
        })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), schemaDocAsText(), pdfWasmAssets()],
})
