import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
} from '@/shared/api/contracts'
import {
  deletePalaceApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  getSegmentPracticeSessionProgressApi,
} from '@/entities/palace/api'
import { buildReviewSessionPath } from '@/entities/review'
import { getPalaceSegmentApi } from '@/entities/palace-segment/api'
import { prefetchStudySession } from '@/shared/api/studySessionWarmup'

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

  const shouldOpenFormalReview = (palace: PalaceGroupedItem) => {
    const nodeCount = Number(palace.memory_node_count ?? 0)
    if (nodeCount <= 0) return false
    const dueCount = Number(palace.due_node_count ?? 0)
    const entryMode = palace.review_entry_mode
    if (dueCount > 0 || entryMode === 'node' || entryMode === 'palace' || palace.has_due_review) {
      return true
    }
    // Future / later-today FSRS cards still open formal review (early review).
    return Boolean(palace.memory_next_review_at ?? palace.next_review_at)
  }

  const handlePalacePractice = (palace: PalaceGroupedItem) => {
    if (shouldOpenFormalReview(palace)) {
      // Formal FSRS resolve accepts palace id and starts/resumes the review StudySession.
      navigate(buildReviewSessionPath(palace.id))
      return
    }
    navigate(`/palaces/${palace.id}/practice`)
  }

  const handleWarmPalacePractice = (palace: PalaceGroupedItem) => {
    if (shouldOpenFormalReview(palace)) {
      prefetchReviewSession?.(palace.id)
      return
    }
    prefetchStudySession('palace-practice', palace.id, () =>
      Promise.all([getPalaceEditorApi(palace.id), getPracticeSessionProgressApi(palace.id)]).then(
        ([session, progress]) => ({ session, progress }),
      ),
    )
  }

  const handleSegmentPractice = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      navigate(buildReviewSessionPath(segment.current_review_schedule_id))
      return
    }
    // Virtual default / whole-palace segment → formal FSRS by palace id.
    if (segment.is_virtual_default || segment.id === 0) {
      navigate(buildReviewSessionPath(segment.palace_id))
      return
    }
    navigate(`/segments/${segment.id}/practice`)
  }

  const handleWarmSegmentPractice = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      prefetchReviewSession?.(segment.current_review_schedule_id)
      return
    }
    if (segment.is_virtual_default || segment.id === 0) {
      prefetchReviewSession?.(segment.palace_id)
      return
    }
    prefetchStudySession('segment-practice', segment.id, () =>
      Promise.all([getPalaceSegmentApi(segment.id), getSegmentPracticeSessionProgressApi(segment.id)]).then(
        ([session, progress]) => ({ session, progress }),
      ),
    )
  }

  return {
    onPalacePractice: (palace: PalaceGroupedItem) => void handlePalacePractice(palace),
    onWarmPalacePractice: handleWarmPalacePractice,
    onSegmentPractice: (segment: PalaceSegmentSummary) => void handleSegmentPractice(segment),
    onWarmSegmentPractice: handleWarmSegmentPractice,
    onDelete: (id: number, title: string) => void handleDelete(id, title),
  }
}
