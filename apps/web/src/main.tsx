import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './app/App'
import { AppErrorBoundary } from '@/app/providers/AppErrorBoundary'
import { cleanupLegacyPracticeProgressStorage } from './entities/session/model'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import { initApiTokenFromUrl } from '@/shared/api/apiToken'
import { initializeTheme } from './shared/theme/themePreference'

initApiTokenFromUrl()
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

registerServiceWorker()
cleanupLegacyPracticeProgressStorage()
