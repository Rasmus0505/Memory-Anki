import * as React from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { createAppQueryClient } from '@/shared/api/queryClient'
import TimerOverlayPage from '@/modules/session/ui/timer-overlay/TimerOverlayPage'

const queryClient = createAppQueryClient()

export function TimerOverlayApp() {
  React.useEffect(() => {
    document.body.classList.add('memory-anki-timer-overlay-page')
    document.documentElement.classList.add('memory-anki-timer-overlay-page')
    return () => {
      document.body.classList.remove('memory-anki-timer-overlay-page')
      document.documentElement.classList.remove('memory-anki-timer-overlay-page')
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TimerOverlayPage />
        <Toaster position="bottom-right" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
