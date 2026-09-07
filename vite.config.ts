import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const SCHEMA_DOC = '/track-schema.md'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), schemaDocAsText()],
})
