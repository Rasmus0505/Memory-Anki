import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { MindMapRecallRating, ReviewIntervalPreview } from '@/shared/api/contracts'
import { previewReviewIntervalsApi } from '@/modules/practice/ui/review/api/scheduleInsightApi'
import {
  reviewInsightQueryKeys,
  useReviewInsightInvalidation,
  useReviewInsightQueryClient,
} from './reviewInsightQueries'

export type IntervalPreviewByRating = Partial<Record<MindMapRecallRating, ReviewIntervalPreview>>

function toByRating(previews: ReviewIntervalPreview[] | undefined): IntervalPreviewByRating {
  const byRating: IntervalPreviewByRating = {}
  for (const preview of previews ?? []) {
    if (preview.rating >= 1 && preview.rating <= 4) {
      byRating[preview.rating as MindMapRecallRating] = preview
    }
  }
  return byRating
}

/**
 * Four-button next-interval previews for the card being rated.
 *
 * - Fetches the current card on entry and batch-prefetches the next few queue
 *   cards in the same POST (each seeded under its own query key
 *   `['review','preview',palaceId,nodeUid]`).
 * - Rating mutations emit the global review-state event; that invalidates the
 *   preview / today-plan / forecast caches (see useReviewInsightInvalidation).
 * - Loading or failure never blocks rating — callers render buttons without the
 *   interval hint when `getPreviewDisplay` returns null.
 */
export function useIntervalPreviews({
  palaceId,
  nodeUid,
  upcomingNodeUids = [],
  enabled = true,
}: {
  palaceId: number | null | undefined
  nodeUid: string | null | undefined
  /** Queue lookahead prefetched together with the current card (batched). */
  upcomingNodeUids?: string[]
  enabled?: boolean
}) {
  const queryClient = useReviewInsightQueryClient()
  useReviewInsightInvalidation(queryClient)
  const queryEnabled = Boolean(enabled && palaceId && nodeUid)

  const query = useQuery(
    {
      queryKey:
        palaceId && nodeUid
          ? reviewInsightQueryKeys.intervalPreview(palaceId, nodeUid)
          : ['review', 'preview', 'idle'],
      enabled: queryEnabled,
      staleTime: 60_000,
      retry: false,
      queryFn: async () => {
        const pid = palaceId as number
        const current = nodeUid as string
        const lookahead = upcomingNodeUids
          .filter((uid) => uid && uid !== current)
          .filter(
            (uid) =>
              queryClient.getQueryState(reviewInsightQueryKeys.intervalPreview(pid, uid))
                ?.status !== 'success',
          )
          .slice(0, 7)
        const response = await previewReviewIntervalsApi(
          [current, ...lookahead].map((uid) => ({ palace_id: pid, node_uid: uid })),
        )
        let currentByRating: IntervalPreviewByRating = {}
        for (const item of response.items) {
          const byRating = toByRating(item.previews)
          if (item.node_uid === current) {
            currentByRating = byRating
          } else {
            queryClient.setQueryData(
              reviewInsightQueryKeys.intervalPreview(pid, item.node_uid),
              byRating,
            )
          }
        }
        return currentByRating
      },
    },
    queryClient,
  )

  const currentPreviews: IntervalPreviewByRating | null = query.data ?? null

  /**
   * Interval display for any node already in cache (current card is reactive;
   * other cards resolve from the prefetch cache). Null while loading/failed.
   */
  const getPreviewDisplay = useCallback(
    (uid: string, rating: MindMapRecallRating): string | null => {
      if (!palaceId || !uid) return null
      const byRating =
        uid === nodeUid
          ? currentPreviews
          : queryClient.getQueryData<IntervalPreviewByRating>(
              reviewInsightQueryKeys.intervalPreview(palaceId, uid),
            ) ?? null
      const display = byRating?.[rating]?.display
      return display && display.trim() ? display : null
    },
    [currentPreviews, nodeUid, palaceId, queryClient],
  )

  return {
    previews: currentPreviews,
    loading: queryEnabled && query.isPending,
    getPreviewDisplay,
  }
}
