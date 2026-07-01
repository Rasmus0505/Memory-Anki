import { AppProviders } from '@/app/providers/AppProviders'
import { AppRouter } from '@/app/router/AppRouter'
import { AppShell } from '@/app/shell/AppShell'
import { TimerOverlayApp } from '@/features/timer-overlay/TimerOverlayApp'

export default function App() {
  if (window.location.pathname === '/timer-overlay') {
    return <TimerOverlayApp />
  }

  return (
    <AppProviders>
      <AppShell>
        <AppRouter />
      </AppShell>
    </AppProviders>
  )
}
