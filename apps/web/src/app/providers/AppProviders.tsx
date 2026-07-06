import { type PropsWithChildren, useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { QuizLauncherProvider } from '@/features/palace-quiz/QuizLauncherProvider'
import { GlobalErrorBoundary } from '@/app/providers/GlobalErrorBoundary'
import { createAppQueryClient } from '@/shared/api/queryClient'
import { GlobalFeedbackProvider } from '@/shared/feedback/GlobalFeedbackProvider'
import { cleanupExpiredAppLogs, logAppError } from '@/shared/logs/model/appLogs'
import { useMutationQueueAutoSync } from '@/shared/persistence/useMutationQueue'
import { GlobalTimerProvider } from '@/shared/components/session/GlobalTimerProvider'
import { RouteProgressBar } from '@/shared/components/route-progress/RouteProgressBar'
import { NativeDialogProvider } from '@/shared/components/ui/native-dialog'

const queryClient = createAppQueryClient()

export function AppProviders({ children }: PropsWithChildren) {
  useMutationQueueAutoSync()

  useEffect(() => {
    cleanupExpiredAppLogs()

    const handleWindowError = (event: ErrorEvent) => {
      logAppError({
        feature: 'window.onerror',
        stage: 'global_error',
        error: event.error ?? event.message ?? '未知前端错误',
        responseSummary: typeof event.filename === 'string' ? `${event.filename}:${event.lineno}:${event.colno}` : '',
        meta: {
          source: event.filename || '',
          lineno: event.lineno || 0,
          colno: event.colno || 0,
        },
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logAppError({
        feature: 'unhandledrejection',
        stage: 'global_promise_error',
        error: event.reason,
      })
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <RouteProgressBar />
        <GlobalErrorBoundary>
          <GlobalFeedbackProvider>
            <GlobalTimerProvider>
              <QuizLauncherProvider>
                {children}
                <NativeDialogProvider />
                <Toaster position="bottom-right" richColors />
              </QuizLauncherProvider>
            </GlobalTimerProvider>
          </GlobalFeedbackProvider>
        </GlobalErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
