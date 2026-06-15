import { type PropsWithChildren, useEffect } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, toast } from 'sonner'
import { migrateLegacyTimeRecordsToBackend } from '@/entities/session/model'
import { QuizLauncherProvider } from '@/features/palace-quiz/QuizLauncherProvider'
import { GlobalFeedbackProvider } from '@/shared/feedback/GlobalFeedbackProvider'
import { cleanupExpiredAppLogs, logAppError } from '@/shared/logs/model/appLogs'
import { useMutationQueueAutoSync } from '@/shared/persistence/useMutationQueue'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000 },
  },
})

export function AppProviders({ children }: PropsWithChildren) {
  useMutationQueueAutoSync()

  useEffect(() => {
    void migrateLegacyTimeRecordsToBackend().catch((error) => {
      // 历史学习时长迁移失败时通知用户，避免静默丢失数据。
      toast.error('学习时长迁移失败', {
        description: error instanceof Error ? error.message : '请稍后刷新页面重试。',
      })
    })
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
        <GlobalFeedbackProvider>
          <QuizLauncherProvider>
            {children}
            <Toaster position="bottom-right" richColors />
          </QuizLauncherProvider>
        </GlobalFeedbackProvider>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
