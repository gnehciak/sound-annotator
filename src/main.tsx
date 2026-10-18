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
import { parseRoute } from './lib/nav'
import Gate from './components/Gate'
import ShareViewer from './components/ShareViewer'
import AdminProjects from './components/AdminProjects'
import './plugins/register' // registers note plugins (side effect)

// Which page the URL asks for. The root switch is decided once, at load: the
// three shells below are genuinely different (different chrome, different
// auth), so moving between them is a real navigation. Everything *inside* the
// app — library, folders, trash, Browse, a track — routes client-side instead;
// see lib/nav.ts and App's own reconciler.
const route = parseRoute()

// Sign-in needs no route of its own. Google returns to /api/auth/callback — a
// function, not the SPA — which sets the session cookie and 302s back to
// whichever page the visitor started on, so the app boots once, already signed
// in. (Clerk needed an in-app /sso-callback screen to finish the handshake in
// the browser; nothing here does.)
//
// Nor is there a "backend configured?" gate out here any more: the client
// holds no auth config to inspect. Gate asks the server (GET /api/auth/me),
// which is the only thing that actually knows.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* A `?view={id}` link opens the read-only share viewer, which needs no
        sign-in — but "Make a copy" inside it can still sign the visitor in,
        which works anywhere now that useAuth() reads a module-level store
        rather than a provider's context. */}
    {route.page === 'share' ? (
      <ShareViewer projectId={route.id} />
    ) : (
      <AuthProvider>
        {/* `?admin=1` is the teacher's console over every project. It sits
            behind <Gate> for sign-in, but the URL is not what protects it:
            /api/admin/projects enforces an ADMIN_EMAILS allowlist and 404s
            everyone else (see components/AdminProjects). */}
        <Gate>{route.page === 'admin' ? <AdminProjects /> : <App />}</Gate>
      </AuthProvider>
    )}
  </StrictMode>,
)
