import { type PropsWithChildren, useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { migrateLegacyTimeRecordsToBackend } from '@/entities/session/model'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000 },
  },
})

export function AppProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    void migrateLegacyTimeRecordsToBackend().catch(() => undefined)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {children}
        <Toaster position="bottom-right" richColors />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
