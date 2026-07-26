import { QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
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

let fallbackQueryClient: QueryClient | null = null

/**
 * Some hosts (deep widget tests, isolated mounts) render review widgets without
 * the app-level QueryClientProvider. Interval previews are purely additive UI,
 * so fall back to a module-level client instead of crashing the whole panel.
 */
export function useReviewInsightQueryClient(): QueryClient {
  let providerClient: QueryClient | null = null
  try {
    // Stable hook order: useQueryClient is a plain useContext read that throws
    // *after* the context read when no provider exists.
    providerClient = useQueryClient()
  } catch {
    providerClient = null
  }
  if (providerClient) return providerClient
  if (!fallbackQueryClient) {
    fallbackQueryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
    })
  }
  return fallbackQueryClient
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
