import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// IBM Plex, self-hosted (@fontsource) — the type system's two voices. Sans
// carries prose at 400–700 (+italic), Mono carries timecodes/labels at 400–700.
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import Gate from './components/Gate'
import ShareViewer from './components/ShareViewer'
import './plugins/register' // registers note plugins (side effect)

// A `?view={id}` link opens the read-only share viewer, which needs no auth —
// render it before (and instead of) the signed-in app and its Gate.
const viewId = new URLSearchParams(window.location.search).get('view')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {viewId ? (
      <ShareViewer projectId={viewId} />
    ) : (
      <AuthProvider>
        <Gate>
          <App />
        </Gate>
      </AuthProvider>
    )}
  </StrictMode>,
)
