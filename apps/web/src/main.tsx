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
import { markBoot, summarizeBoot } from '@/shared/lib/bootTiming'

markBoot('entry')

initApiTokenFromUrl()
initializeTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
)

markBoot('render')
if (import.meta.env.DEV) {
  // 开发下停一拍再汇总，让外壳的 shell 打点有机会落地。
  window.setTimeout(() => console.info('[memory-anki] boot', summarizeBoot()), 3000)
}

registerServiceWorker()
