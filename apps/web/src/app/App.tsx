import { Suspense } from 'react'
import { AppProviders } from '@/app/providers/AppProviders'
import { lazyWithRetry } from '@/shared/lib/lazyWithRetry'

// These are the first dynamic imports after the entry bundle. They need the
// same bounded recovery as route chunks so a stalled PWA asset request cannot
// leave the application-level Suspense fallback on screen indefinitely.
const DesktopApp = lazyWithRetry(() => import('@/app/DesktopApp'))
const TimerOverlayApp = lazyWithRetry(() =>
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
