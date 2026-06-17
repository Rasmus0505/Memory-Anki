import { useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import { PalaceBatchReviewDialog } from '@/app/router/palace-list/PalaceBatchReviewDialog'
import { PalaceMiniReviewModeDialog } from '@/app/router/palace-list/PalaceMiniReviewModeDialog'
import { toDateTimeLocalValue } from '@/app/router/palace-list/PalaceStageProgress'
import { PalaceStageEditDialog } from '@/app/router/palace-list/PalaceStageEditDialog'
import type {
  MiniReviewMode,
  MiniPalaceSummary,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
  ReviewSessionSubmitResponse,
  ReviewStageSummary,
} from '@/shared/api/contracts'
import {
  deletePalaceApi,
  updateDefaultSegmentReviewProgressApi,
  updatePalaceMiniReviewModeApi,
  updatePalaceSegmentReviewProgressApi,
} from '@/shared/api/modules/palaces'
import { submitMiniReviewSessionApi } from '@/shared/api/modules/reviews'
import { submitSegmentReviewSessionApi } from '@/shared/api/modules/reviews'
import type { StageEditState } from '@/app/router/palace-list/utils'
import {
  buildBatchSegmentReviewPath,
  buildSegmentReviewSessionPath,
} from '@/features/review/reviewSessionRoutes'

function ensureSubmitSucceeded(result: ReviewSessionSubmitResponse) {
  if (!result?.ok) {
    throw new Error('复习提交失败')
  }
  return result
}

interface UsePalaceListCardActionsOptions {
  allPalaces: PalaceGroupedItem[]
  fetchData: () => Promise<PalaceGroupedListResponse>
  navigate: (to: string) => void
}

export function usePalaceListCardActions({
  allPalaces,
  fetchData,
  navigate,
}: UsePalaceListCardActionsOptions) {
  const [batchReviewPalace, setBatchReviewPalace] = useState<PalaceGroupedItem | null>(null)
  const [selectedBatchSegmentIds, setSelectedBatchSegmentIds] = useState<number[]>([])
  const [segmentReviewLoadingId, setSegmentReviewLoadingId] = useState<number | null>(null)
  const [markReviewedKey, setMarkReviewedKey] = useState<string | null>(null)
  const [stageEdit, setStageEdit] = useState<StageEditState | null>(null)
  const [stageCompletedAt, setStageCompletedAt] = useState('')
  const [stageEditError, setStageEditError] = useState<string | null>(null)
  const [stageEditSaving, setStageEditSaving] = useState(false)
  const [miniReviewModePalace, setMiniReviewModePalace] = useState<PalaceGroupedItem | null>(null)
  const [miniReviewModeSaving, setMiniReviewModeSaving] = useState(false)

  const markSegmentReviewedUntilNotDue = async (palaceId: number, segmentId: number) => {
    let latestPalaces = allPalaces
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const palace = latestPalaces.find((item) => item.id === palaceId)
      const segment = palace?.segments.find((item) => item.id === segmentId)
      if (!segment?.has_due_review || !segment.current_review_schedule_id) {
        break
      }
      ensureSubmitSucceeded(
        await submitSegmentReviewSessionApi(segment.current_review_schedule_id, {
          duration_seconds: 0,
          completion_mode: 'manual_complete',
          revealed_remaining: true,
          red_marked_count: 0,
        }),
      )
      latestPalaces = flattenGroupedPalaces(await fetchData())
    }
  }

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除“${title}”吗？此操作无法撤销。`)) return
    await deletePalaceApi(id)
    toast.success('已删除')
    await fetchData()
  }

  const handleSaveMiniReviewMode = async (palaceId: number, mode: MiniReviewMode) => {
    setMiniReviewModeSaving(true)
    try {
      await updatePalaceMiniReviewModeApi(palaceId, { mini_review_mode: mode })
      await fetchData()
      toast.success(mode === 'mini_only' ? '已切换为小宫殿接管复习' : '已切换为独立复习')
      setMiniReviewModePalace(null)
    } catch (error) {
      console.error(error)
      toast.error('保存小宫殿复习归属失败，请稍后重试')
    } finally {
      setMiniReviewModeSaving(false)
    }
  }

  const handleSegmentReviewAction = async (segment: PalaceSegmentSummary) => {
    if (!segment.current_review_schedule_id) return
    setSegmentReviewLoadingId(segment.id)
    try {
      navigate(buildSegmentReviewSessionPath(segment.current_review_schedule_id))
    } finally {
      setSegmentReviewLoadingId(null)
    }
  }

  const handleOpenBatchReview = (palace: PalaceGroupedItem) => {
    const dueSegments = (palace.segments || []).filter(
      (segment) =>
        !segment.is_virtual_default &&
        segment.has_due_review &&
        Boolean(segment.current_review_schedule_id),
    )
    if (dueSegments.length < 2) return
    setBatchReviewPalace(palace)
    setSelectedBatchSegmentIds(dueSegments.map((segment) => segment.id))
  }

  const handleToggleBatchSegment = (segmentId: number, checked: boolean) => {
    setSelectedBatchSegmentIds((current) => {
      if (checked) {
        return current.includes(segmentId) ? current : [...current, segmentId]
      }
      return current.filter((item) => item !== segmentId)
    })
  }

  const handleStartBatchReview = () => {
    if (selectedBatchSegmentIds.length === 0) return
    navigate(buildBatchSegmentReviewPath(selectedBatchSegmentIds))
    setBatchReviewPalace(null)
    setSelectedBatchSegmentIds([])
  }

  const handleMarkSegmentReviewed = async (segment: PalaceSegmentSummary) => {
    if (!segment.has_due_review || !segment.current_review_schedule_id) return
    const requestKey = `segment-${segment.id}`
    setMarkReviewedKey(requestKey)
    try {
      await markSegmentReviewedUntilNotDue(segment.palace_id, segment.id)
      toast.success('已标记为完成本轮复习')
    } catch (error) {
      console.error(error)
      toast.error('标记复习失败，请稍后重试')
    } finally {
      setMarkReviewedKey(null)
    }
  }

  const openStageEdit = (
    palace: PalaceGroupedItem,
    segment: PalaceSegmentSummary,
    stage: ReviewStageSummary,
  ) => {
    setStageEdit({ palaceId: palace.id, segment, stage })
    setStageCompletedAt(toDateTimeLocalValue(stage.completed_at))
    setStageEditError(null)
  }

  const submitStageProgress = async (
    completedCount: number,
    completedReviewNumber: number | null,
    completedAt: string | null,
    successMessage: string,
  ) => {
    if (!stageEdit) return
    setStageEditSaving(true)
    setStageEditError(null)
    try {
      const payload = {
        completed_count: completedCount,
        completed_review_number: completedReviewNumber,
        completed_at: completedAt,
      }
      if (stageEdit.segment.is_virtual_default) {
        await updateDefaultSegmentReviewProgressApi(stageEdit.palaceId, payload)
      } else {
        await updatePalaceSegmentReviewProgressApi(stageEdit.segment.id, payload)
      }
      await fetchData()
      toast.success(successMessage)
      setStageEdit(null)
    } catch (error) {
      console.error(error)
      setStageEditError(error instanceof Error ? error.message : '进度更新失败，请稍后重试')
    } finally {
      setStageEditSaving(false)
    }
  }

  const currentStageCompletedCount = stageEdit
    ? stageEdit.segment.review_stages.filter((stage) => stage.completed).length
    : 0

  const dialogs = (
    <>
      <PalaceBatchReviewDialog
        palace={batchReviewPalace}
        selectedSegmentIds={selectedBatchSegmentIds}
        onToggleSegment={handleToggleBatchSegment}
        onClose={() => {
          setBatchReviewPalace(null)
          setSelectedBatchSegmentIds([])
        }}
        onStart={handleStartBatchReview}
      />

      <PalaceStageEditDialog
        stageEdit={stageEdit}
        stageCompletedAt={stageCompletedAt}
        stageEditError={stageEditError}
        stageEditSaving={stageEditSaving}
        onStageCompletedAtChange={setStageCompletedAt}
        onClose={() => setStageEdit(null)}
        onSaveCompletedAt={() =>
          void submitStageProgress(
            currentStageCompletedCount,
            stageEdit?.stage.review_number ?? null,
            stageCompletedAt,
            '完成时间已更新',
          )
        }
        onAdvanceToStage={() =>
          void submitStageProgress(
            (stageEdit?.stage.review_number ?? -1) + 1,
            null,
            stageCompletedAt,
            '复习进度已前进',
          )
        }
        onRollbackBeforeStage={() => void submitStageProgress(stageEdit?.stage.review_number ?? 0, null, null, '复习进度已回退')}
      />

      <PalaceMiniReviewModeDialog
        palace={miniReviewModePalace}
        saving={miniReviewModeSaving}
        onClose={() => setMiniReviewModePalace(null)}
        onSave={(palaceId, mode) => void handleSaveMiniReviewMode(palaceId, mode)}
      />
    </>
  )

  const handleMiniPalacePractice = (mini: MiniPalaceSummary) => {
    navigate(`/palaces/${mini.palace_id}/quiz?tab=practice&miniPalaceId=${mini.id}`)
  }

  const handleMiniPalaceReview = (mini: MiniPalaceSummary) => {
    if (!mini.current_review_schedule_id) return
    navigate(`/mini-review/session/${mini.current_review_schedule_id}`)
  }

  return {
    segmentReviewLoadingId,
    markReviewedKey,
    onOpenBatchReview: handleOpenBatchReview,
    onSegmentReviewAction: (segment: PalaceSegmentSummary) => void handleSegmentReviewAction(segment),
    onOpenStageEdit: openStageEdit,
    onMarkSegmentReviewed: (segment: PalaceSegmentSummary) => void handleMarkSegmentReviewed(segment),
    onMiniPalacePractice: (mini: MiniPalaceSummary) => void handleMiniPalacePractice(mini),
    onMiniPalaceReview: (mini: MiniPalaceSummary) => void handleMiniPalaceReview(mini),
    onOpenConfig: (palace: PalaceGroupedItem) => setMiniReviewModePalace(palace),
    onDelete: (id: number, title: string) => void handleDelete(id, title),
    dialogs,
  }
}

function flattenGroupedPalaces(data: PalaceGroupedListResponse) {
  const list: PalaceGroupedItem[] = []
  for (const subject of data.subjects) {
    for (const group of subject.chapter_groups) {
      list.push(...group.palaces)
    }
    list.push(...subject.ungrouped_palaces)
  }
  return list
}
