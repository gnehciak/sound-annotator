import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import Gate from './components/Gate'
import ShareViewer from './components/ShareViewer'

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
