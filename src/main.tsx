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
import { PublicBrowsePage } from './components/BrowseGallery'
import AdminProjects from './components/AdminProjects'
import './plugins/register' // registers note plugins (side effect)

const params = new URLSearchParams(window.location.search)
// A `?view={id}` link opens the read-only share viewer, which needs no
// sign-in — but "Make a copy" inside it can still sign the visitor in, which
// works anywhere now that useAuth() reads a module-level store rather than a
// provider's context.
const viewId = params.get('view')
// `?browse=1` opens the public gallery of published tracks — no sign-in.
const browse = params.get('browse') === '1'
// `?admin=1` is the teacher's console over every project. It sits behind
// <Gate> for sign-in, but the URL is not what protects it:
// /api/admin/projects enforces an ADMIN_EMAILS allowlist and 404s everyone
// else (see components/AdminProjects).
//
// `?track=…&admin=1` is a different thing — the console's Edit button — so the
// track param wins and the app opens instead of the console.
const admin = params.get('admin') === '1' && !params.get('track')

// Sign-in no longer needs a route of its own. Google returns to
// /api/auth/callback — a function, not the SPA — which sets the session cookie
// and 302s back to whichever page the visitor started on, so the app boots
// once, already signed in. (Clerk needed an in-app /sso-callback screen to
// finish the handshake in the browser; nothing here does.)
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {viewId ? (
      <ShareViewer projectId={viewId} />
    ) : browse ? (
      <PublicBrowsePage />
    ) : (
      <AuthProvider>
        <Gate>{admin ? <AdminProjects /> : <App />}</Gate>
      </AuthProvider>
    )}
  </StrictMode>,
)
