import { QueryClient, QueryClientContext } from '@tanstack/react-query'
import { useContext, useEffect } from 'react'
import { APP_EVENT_NAMES, onAppEvent } from '@/shared/events/appEvents'

/** Query keys of the scheduling transparency layer. */
export const reviewInsightQueryKeys = {
  todayPlan: ['review', 'today-plan'] as const,
  loadForecast: (days: number) => ['review', 'load-forecast', days] as const,
  intervalPreview: (palaceId: number, nodeUid: string) =>
    ['review', 'preview', palaceId, nodeUid] as const,
  scheduleDetail: (palaceId: number, nodeUid: string) =>
    ['review', 'schedule-detail', palaceId, nodeUid] as const,
}

const fallbackQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
})

/** Return the provider client when present, otherwise an isolated additive-UI client. */
export function useReviewInsightQueryClient(): QueryClient {
  return useContext(QueryClientContext) ?? fallbackQueryClient
}

/**
 * Invalidate schedule-derived queries whenever a rating/calibration mutation
 * fires the global review-state event. Keeps preview intervals / today plan /
 * load forecast fresh without coupling the rating hooks to react-query.
 */
export function useReviewInsightInvalidation(queryClient: QueryClient) {
  useEffect(() => {
    return onAppEvent(APP_EVENT_NAMES.reviewStateChanged, () => {
      void queryClient.invalidateQueries({ queryKey: ['review', 'preview'] })
      void queryClient.invalidateQueries({ queryKey: ['review', 'schedule-detail'] })
      void queryClient.invalidateQueries({ queryKey: reviewInsightQueryKeys.todayPlan })
      void queryClient.invalidateQueries({ queryKey: ['review', 'load-forecast'] })
    })
  }, [queryClient])
}
