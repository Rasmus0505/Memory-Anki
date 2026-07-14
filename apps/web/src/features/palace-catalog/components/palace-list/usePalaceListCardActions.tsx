import { useEffect, useState } from 'react'
import { toast } from '@/shared/feedback/toast'
import { appConfirm } from '@/shared/components/ui/native-dialog'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
  ReviewStageSummary,
  ReviewStageAdjustmentResponse,
} from '@/shared/api/contracts'
import {
  deletePalaceApi,
  getPalaceEditorApi,
  getPracticeSessionProgressApi,
  getSegmentPracticeSessionProgressApi,
  invalidatePalaceCatalogCache,
} from '@/entities/palace/api'
import {
  applyReviewStageAdjustmentApi,
  buildReviewSessionPath,
  previewReviewStageAdjustmentApi,
} from '@/entities/review'
import { getPalaceSegmentApi } from '@/entities/palace-segment/api'
import { prefetchStudySession } from '@/shared/api/studySessionWarmup'
import { toDateTimeLocalValue } from './PalaceStageProgress'
import { PalaceStageEditDialog } from './PalaceStageEditDialog'
import type { StageEditState } from './utils'

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
  const [stageEdit, setStageEdit] = useState<StageEditState | null>(null)
  const [stageCompletedAt, setStageCompletedAt] = useState('')
  const [stageNeedsPractice, setStageNeedsPractice] = useState(false)
  const [stageNote, setStageNote] = useState('')
  const [stagePreview, setStagePreview] = useState<ReviewStageAdjustmentResponse | null>(null)
  const [stagePreviewLoading, setStagePreviewLoading] = useState(false)
  const [stageEditError, setStageEditError] = useState<string | null>(null)
  const [stageEditSaving, setStageEditSaving] = useState(false)

  useEffect(() => {
    if (!stageEdit) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      setStagePreviewLoading(true)
      setStageEditError(null)
      void previewReviewStageAdjustmentApi(stageEdit.palace.id, {
        target_completed_count: stageEdit.targetCompletedCount,
        completed_at: stageEdit.targetCompletedCount > 0 ? stageCompletedAt || null : null,
        needs_practice: stageNeedsPractice,
      })
        .then((preview) => {
          if (!cancelled) setStagePreview(preview)
        })
        .catch((error) => {
          if (cancelled) return
          setStagePreview(null)
          setStageEditError(error instanceof Error ? error.message : '计算复习安排失败。')
        })
        .finally(() => {
          if (!cancelled) setStagePreviewLoading(false)
        })
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [stageCompletedAt, stageEdit, stageNeedsPractice])

  const closeStageEdit = () => {
    if (stageEditSaving) return
    setStageEdit(null)
    setStagePreview(null)
    setStageEditError(null)
  }

  const openStageEdit = (palace: PalaceGroupedItem, stage: ReviewStageSummary) => {
    setStageEdit({
      palace,
      stage,
      targetCompletedCount: stage.review_number + 1,
    })
    setStageCompletedAt(toDateTimeLocalValue(stage.completed_at))
    setStageNeedsPractice(Boolean(palace.needs_practice))
    setStageNote('')
    setStagePreview(null)
    setStageEditError(null)
  }

  const applyStageAdjustment = async (targetCompletedCount: number) => {
    if (!stageEdit || !stagePreview) return
    setStageEditSaving(true)
    setStageEditError(null)
    try {
      const response = await applyReviewStageAdjustmentApi(stageEdit.palace.id, {
        target_completed_count: targetCompletedCount,
        completed_at: targetCompletedCount > 0 ? stageCompletedAt || null : null,
        needs_practice: stageNeedsPractice,
        expected_completed_count: stagePreview.previous_completed_count,
        note: stageNote.trim(),
      })
      invalidatePalaceCatalogCache()
      setStageEdit(null)
      setStagePreview(null)
      toast.success(
        targetCompletedCount === 0
          ? `宫殿“${response.palace_title}”已重置为未开始。`
          : `宫殿“${response.palace_title}”已调整到“${response.target_stage_label ?? '目标阶段'}”。`,
      )
      await fetchData()
    } catch (error) {
      setStageEditError(error instanceof Error ? error.message : '调整复习进度失败。')
    } finally {
      setStageEditSaving(false)
    }
  }

  const resetStageAdjustment = async () => {
    if (!stageEdit || !stagePreview) return
    const confirmed = await appConfirm(
      `确定将宫殿“${stageEdit.palace.resolved_title || stageEdit.palace.title}”重置为未开始吗？所有已完成阶段都会被撤销，并重新生成首次复习安排。`,
      {
        title: '重置复习进度',
        confirmText: '重置为未开始',
        tone: 'danger',
      },
    )
    if (confirmed) await applyStageAdjustment(0)
  }

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
    navigate(`/segments/${segment.id}/practice`)
  }

  const handleWarmSegmentPractice = (segment: PalaceSegmentSummary) => {
    if (segment.current_review_schedule_id) {
      prefetchReviewSession?.(segment.current_review_schedule_id)
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
    onStageClick: openStageEdit,
    onDelete: (id: number, title: string) => void handleDelete(id, title),
    dialogs: (
      <PalaceStageEditDialog
        stageEdit={stageEdit}
        completedAt={stageCompletedAt}
        needsPractice={stageNeedsPractice}
        note={stageNote}
        preview={stagePreview}
        previewLoading={stagePreviewLoading}
        error={stageEditError}
        saving={stageEditSaving}
        onCompletedAtChange={setStageCompletedAt}
        onNeedsPracticeChange={setStageNeedsPractice}
        onNoteChange={setStageNote}
        onClose={closeStageEdit}
        onConfirm={() => void applyStageAdjustment(stageEdit?.targetCompletedCount ?? 0)}
        onReset={() => void resetStageAdjustment()}
      />
    ),
  }
}
