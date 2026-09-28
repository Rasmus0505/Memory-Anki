import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/nunito'
import '@fontsource-variable/noto-sans-sc'
import './index.css'
import App from './app/App'
import { AppErrorBoundary } from '@/app/providers/AppErrorBoundary'
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
