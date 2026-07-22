import { Suspense, lazy } from 'react'
import { AppProviders } from '@/app/providers/AppProviders'

const DesktopApp = lazy(() => import('@/app/DesktopApp'))
const TimerOverlayApp = lazy(() =>
  import('@/modules/session/ui/timer-overlay/TimerOverlayApp').then((module) => ({
    default: module.TimerOverlayApp,
  })),
)

function AppFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      正在加载...
    </div>
  )
}

export default function App() {
  if (window.location.pathname === '/timer-overlay') {
    return (
      <Suspense fallback={<AppFallback />}>
        <TimerOverlayApp />
      </Suspense>
    )
  }

  return (
    <AppProviders>
      <Suspense fallback={<AppFallback />}>
        <DesktopApp />
      </Suspense>
    </AppProviders>
  )
}
