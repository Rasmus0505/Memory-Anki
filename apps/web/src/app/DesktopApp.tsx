import { AppRouter } from '@/app/router/AppRouter'
import { AppShell } from '@/app/shell/AppShell'
import { CityFloatingWindow } from '@/modules/city/public'

export default function DesktopApp() {
  return (
    <>
      <AppShell>
        <AppRouter />
      </AppShell>
      <CityFloatingWindow />
    </>
  )
}
