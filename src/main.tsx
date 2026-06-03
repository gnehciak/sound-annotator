import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './lib/auth'
import Gate from './components/Gate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <Gate>
        <App />
      </Gate>
    </AuthProvider>
  </StrictMode>,
)
