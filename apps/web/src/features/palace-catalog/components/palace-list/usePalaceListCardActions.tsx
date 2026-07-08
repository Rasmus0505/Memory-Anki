import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type {
  MiniPalaceSummary,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
} from '@/shared/api/contracts'
import { deletePalaceApi } from '@/entities/palace/api'
import { buildReviewSessionPath } from '@/features/review/reviewSessionRoutes'
import { prefetchStudySession } from '@/features/review/studyWarmup'

interface UsePalaceListCardActionsOptions {
  allPalaces: PalaceGroupedItem[]
  fetchData: () => Promise<PalaceGroupedListResponse>
  navigate: (to: string) => void
}

export function usePalaceListCardActions({
  fetchData,
  navigate,
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

  const handlePalacePractice = (palace: PalaceGroupedItem) => {
    navigate(`/palaces/${palace.id}/practice`)
  }

  const handleWarmPalacePractice = (palace: PalaceGroupedItem) => {
    prefetchStudySession('palace-practice', palace.id)
  }

  const handleWarmFocusPractice = (palace: PalaceGroupedItem) => {
    prefetchStudySession('focus-practice', palace.id)
  }

  const handleSegmentPractice = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      navigate(buildReviewSessionPath(segment.current_review_schedule_id))
      return
    }
    navigate(`/segments/${segment.id}/practice`)
  }

  const handleWarmSegmentPractice = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      prefetchStudySession('review-session', segment.current_review_schedule_id)
      return
    }
    prefetchStudySession('segment-practice', segment.id)
  }

  const handleMiniPalacePractice = (mini: MiniPalaceSummary) => {
    navigate(`/mini-palaces/${mini.id}/practice`)
  }

  const handleWarmMiniPalacePractice = (mini: MiniPalaceSummary) => {
    prefetchStudySession('mini-practice', mini.id)
  }

  return {
    onPalacePractice: (palace: PalaceGroupedItem) => void handlePalacePractice(palace),
    onWarmPalacePractice: handleWarmPalacePractice,
    onWarmFocusPractice: handleWarmFocusPractice,
    onSegmentPractice: (segment: PalaceSegmentSummary) => void handleSegmentPractice(segment),
    onWarmSegmentPractice: handleWarmSegmentPractice,
    onMiniPalacePractice: (mini: MiniPalaceSummary) => void handleMiniPalacePractice(mini),
    onWarmMiniPalacePractice: handleWarmMiniPalacePractice,
    onDelete: (id: number, title: string) => void handleDelete(id, title),
    dialogs: null,
  }
}
