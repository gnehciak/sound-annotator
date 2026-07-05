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
import Gate, { SetupNotice } from './components/Gate'
import ShareViewer from './components/ShareViewer'
import { PublicBrowsePage } from './components/BrowseGallery'
import './plugins/register' // registers note plugins (side effect)

const params = new URLSearchParams(window.location.search)
// A `?view={id}` link opens the read-only share viewer, which needs no
// sign-in — but it still mounts under ClerkProvider so "Make a copy" can
// authenticate.
const viewId = params.get('view')
// `?browse=1` opens the public gallery of published tracks — no sign-in.
const browse = params.get('browse') === '1'
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
      >
        <ApiTokenBridge />
        {ssoCallback ? (
          <AuthenticateWithRedirectCallback />
        ) : viewId ? (
          <ShareViewer projectId={viewId} />
        ) : browse ? (
          <PublicBrowsePage />
        ) : (
          <AuthProvider>
            <Gate>
              <App />
            </Gate>
          </AuthProvider>
        )}
      </ClerkProvider>
    )}
  </StrictMode>,
)
