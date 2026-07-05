import { toast } from '@/shared/feedback/toast'
import type {
  MiniPalaceSummary,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
} from '@/shared/api/contracts'
import { deletePalaceApi } from '@/entities/palace/api'
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
    if (!confirm(`确定删除“${title}”吗？此操作无法撤销。`)) return
    await deletePalaceApi(id)
    toast.success('已删除')
    await fetchData()
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
    navigate(`/segments/${segment.id}/practice`)
  }

  const handleWarmSegmentPractice = (segment: PalaceSegmentSummary) => {
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
