import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
} from '@/shared/api/contracts'
import { deletePalaceApi } from '@/modules/content/domain/palace-entity/api'
import { buildReviewSessionPath } from '@/modules/memory/public'

interface UsePalaceListCardActionsOptions {
  allPalaces: PalaceGroupedItem[]
  fetchData: () => Promise<PalaceGroupedListResponse>
  navigate: (to: string) => void
  prefetchReviewSession?: (reviewId: number) => void
}

export function usePalaceListCardActions({
  fetchData,
  navigate,
  prefetchReviewSession,
}: UsePalaceListCardActionsOptions) {
  const handleDelete = async (id: number, title: string) => {
    const confirmed = await appConfirm(
      `确定删除宫殿“${title}”吗？此操作不可撤销，宫殿内容、分组和练习记录都会被删除。`,
      {
        title: '删除宫殿',
        confirmText: '删除宫殿',
        tone: 'danger',
      },
    )
    if (!confirmed) return
    try {
      await deletePalaceApi(id)
      toast.success(`宫殿“${title}”已删除，列表已刷新。`)
      await fetchData()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除宫殿失败，请刷新列表后再试。')
    }
  }

  const handlePalaceReview = (palace: PalaceGroupedItem) => {
    navigate(buildReviewSessionPath(palace.id))
  }

  const handleWarmPalaceReview = (palace: PalaceGroupedItem) => {
    prefetchReviewSession?.(palace.id)
  }

  const handleSegmentReview = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      navigate(buildReviewSessionPath(segment.current_review_schedule_id))
      return
    }
    // Virtual default / whole-palace segment → formal FSRS by palace id.
    navigate(buildReviewSessionPath(segment.palace_id))
  }

  const handleWarmSegmentReview = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      prefetchReviewSession?.(segment.current_review_schedule_id)
      return
    }
    prefetchReviewSession?.(segment.palace_id)
  }

  return {
    onPalaceReview: (palace: PalaceGroupedItem) => void handlePalaceReview(palace),
    onWarmPalaceReview: handleWarmPalaceReview,
    onSegmentReview: (segment: PalaceSegmentSummary) => void handleSegmentReview(segment),
    onWarmSegmentReview: handleWarmSegmentReview,
    onDelete: (id: number, title: string) => void handleDelete(id, title),
  }
}
