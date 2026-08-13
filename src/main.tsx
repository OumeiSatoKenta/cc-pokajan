import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './ui/auth/AuthGate.tsx'

// AuthGate は AWS 版でのみログインを要求し、Pages 版は素通しする（aws-amplify は静的に読み込まない）。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
)
