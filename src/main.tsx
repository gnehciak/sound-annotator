import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ClerkProvider,
  AuthenticateWithRedirectCallback,
} from '@clerk/clerk-react'
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
import { AuthProvider, ApiTokenBridge } from './lib/auth'
import { backendReady } from './lib/api'
import { parseRoute } from './lib/nav'
import Gate, { SetupNotice } from './components/Gate'
import ShareViewer from './components/ShareViewer'
import { PublicBrowsePage } from './components/BrowseGallery'
import AdminProjects from './components/AdminProjects'
import './plugins/register' // registers note plugins (side effect)

// Which page the URL asks for. The root switch is decided once, at load: the
// four pages below are genuinely different shells (different chrome, different
// auth), so moving between them is a real navigation. Everything *inside* the
// app — library, folders, trash, Browse, a track — routes client-side instead;
// see lib/nav.ts and App's own reconciler.
const route = parseRoute()
// Clerk's OAuth redirect lands here mid-sign-in (see lib/auth.tsx).
const ssoCallback = window.location.pathname === '/sso-callback'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {!backendReady ? (
      <SetupNotice />
    ) : (
      <ClerkProvider
        publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string}
        afterSignOutUrl="/"
        // Clerk titles its card with the instance name from the dashboard
        // ("clerk-aureolin-lever"); say who we actually are instead. The
        // `Combined` keys are the ones the withSignUp flow renders (see
        // components/Gate.tsx).
        localization={{
          signIn: {
            start: {
              titleCombined: 'Sign in to Sound Annotator',
              subtitleCombined:
                'Keep your tracks and notes synced across devices.',
            },
          },
        }}
      >
        <ApiTokenBridge />
        {ssoCallback ? (
          <AuthenticateWithRedirectCallback />
        ) : /* A `?view={id}` link opens the read-only share viewer, which
               needs no sign-in — but it still mounts under ClerkProvider so
               "Make a copy" can authenticate. */
        route.page === 'share' ? (
          <ShareViewer projectId={route.id} />
        ) : /* `?browse=1` is the public gallery of published tracks — no
               sign-in, and so outside the Gate. */
        route.page === 'gallery' ? (
          <PublicBrowsePage />
        ) : (
          <AuthProvider>
            {/* `?admin=1` is the teacher's console over every project. It sits
                behind <Gate> for sign-in, but the URL is not what protects it:
                /api/admin/projects enforces an ADMIN_EMAILS allowlist and 404s
                everyone else (see components/AdminProjects). */}
            <Gate>{route.page === 'admin' ? <AdminProjects /> : <App />}</Gate>
          </AuthProvider>
        )}
      </ClerkProvider>
    )}
  </StrictMode>,
)
