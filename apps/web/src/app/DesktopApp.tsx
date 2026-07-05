import { AppRouter } from '@/app/router/AppRouter'
import { AppShell } from '@/app/shell/AppShell'

export default function DesktopApp() {
  return (
    <AppShell>
      <AppRouter />
    </AppShell>
  )
}
