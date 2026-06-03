import { ArrowLeft, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  PalaceBatchReviewDialog,
} from '@/app/router/palace-list/PalaceBatchReviewDialog'
import { toDateTimeLocalValue } from '@/app/router/palace-list/PalaceStageProgress'
import {
  PalaceListCard,
} from '@/app/router/palace-list/PalaceListCard'
import {
  PalaceListSections,
} from '@/app/router/palace-list/PalaceListSections'
import {
  PalaceListToolbar,
} from '@/app/router/palace-list/PalaceListToolbar'
import {
  PalaceStageEditDialog,
} from '@/app/router/palace-list/PalaceStageEditDialog'
import {
  DEFAULT_PALACE_LIST_VIEW_SETTINGS,
  PALACE_LIST_VIEW_SETTINGS_KEY,
  type PalaceListViewSettings,
  isPalaceListViewSettings,
} from '@/app/router/palace-view-settings'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceSegmentSummary,
  ReviewSessionSubmitResponse,
  ReviewStageSummary,
} from '@/shared/api/contracts'
import {
  deletePalaceApi,
  getPalacesGroupedApi,
  updateDefaultSegmentReviewProgressApi,
  updatePalaceSegmentReviewProgressApi,
} from '@/shared/api/modules/palaces'
import { submitSegmentReviewSessionApi } from '@/shared/api/modules/reviews'
import { Button } from '@/shared/components/ui/button'
import { useLocalStorageState } from '@/shared/lib/localStorage'
import type { StageEditState } from '@/app/router/palace-list/utils'

function ensureSubmitSucceeded(result: ReviewSessionSubmitResponse) {
  if (!result?.ok) {
    throw new Error('复习提交失败')
  }
  return result
}

export default function PalaceList() {
  const navigate = useNavigate()
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse>({
    groups: [],
    ungrouped: [],
    subjects: [],
  })
  const [batchReviewPalace, setBatchReviewPalace] = useState<PalaceGroupedItem | null>(null)
  const [selectedBatchSegmentIds, setSelectedBatchSegmentIds] = useState<number[]>([])
  const [segmentReviewLoadingId, setSegmentReviewLoadingId] = useState<number | null>(null)
  const [markReviewedKey, setMarkReviewedKey] = useState<string | null>(null)
  const [stageEdit, setStageEdit] = useState<StageEditState | null>(null)
  const [stageCompletedAt, setStageCompletedAt] = useState('')
  const [stageEditError, setStageEditError] = useState<string | null>(null)
  const [stageEditSaving, setStageEditSaving] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const selectedSubjectId = searchParams.get('subjectId')
  const showUncategorizedOnly = searchParams.get('uncategorized') === 'true'
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())
  const [viewSettings, setViewSettings] = useLocalStorageState<PalaceListViewSettings>(
    PALACE_LIST_VIEW_SETTINGS_KEY,
    DEFAULT_PALACE_LIST_VIEW_SETTINGS,
    isPalaceListViewSettings,
  )

  const fetchData = useCallback(async () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    if (selectedSubjectId) params.subject_id = selectedSubjectId
    const data = await getPalacesGroupedApi(params)
    const filteredData = showUncategorizedOnly
      ? {
          ...data,
          subjects: data.subjects.filter((subject) => subject.subject == null),
        }
      : selectedSubjectId
        ? {
            ...data,
            subjects: data.subjects.filter((subject) => String(subject.subject?.id ?? '') === selectedSubjectId),
          }
        : data
    setGroupedData(filteredData)
    return filteredData
  }, [search, selectedSubjectId, showUncategorizedOnly])

  const flattenGroupedPalaces = useCallback((data: PalaceGroupedListResponse) => {
    const list: PalaceGroupedItem[] = []
    for (const subject of data.subjects) {
      for (const group of subject.chapter_groups) {
        list.push(...group.palaces)
      }
      list.push(...subject.ungrouped_palaces)
    }
    return list
  }, [])

  const allPalaces = useMemo(() => flattenGroupedPalaces(groupedData), [flattenGroupedPalaces, groupedData])

  const currentSubjectTitle = useMemo(() => {
    if (showUncategorizedOnly) return '未分类'
    return (
      groupedData.subjects.find((subject) => String(subject.subject?.id ?? '') === selectedSubjectId)?.subject
        ?.name ?? null
    )
  }, [groupedData.subjects, selectedSubjectId, showUncategorizedOnly])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

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
    void fetchData()
  }

  const handleSegmentReviewAction = async (segment: PalaceSegmentSummary) => {
    if (!segment.current_review_schedule_id) return
    setSegmentReviewLoadingId(segment.id)
    try {
      navigate(`/segment-review/session/${segment.current_review_schedule_id}`)
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
    navigate(`/segment-review/batch?segmentIds=${selectedBatchSegmentIds.join(',')}`)
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

  const handleSaveStageCompletedAt = () => {
    if (!stageEdit) return
    void submitStageProgress(
      currentStageCompletedCount,
      stageEdit.stage.review_number,
      stageCompletedAt,
      '完成时间已更新',
    )
  }

  const handleAdvanceToStage = () => {
    if (!stageEdit) return
    void submitStageProgress(
      stageEdit.stage.review_number + 1,
      null,
      stageCompletedAt,
      '复习进度已前进',
    )
  }

  const handleRollbackBeforeStage = () => {
    if (!stageEdit) return
    void submitStageProgress(stageEdit.stage.review_number, null, null, '复习进度已回退')
  }

  const renderPalaceCard = useCallback(
    (palace: PalaceGroupedItem) => (
      <PalaceListCard
        key={palace.id}
        palace={palace}
        viewSettings={viewSettings}
        segmentReviewLoadingId={segmentReviewLoadingId}
        markReviewedKey={markReviewedKey}
        onOpenBatchReview={handleOpenBatchReview}
        onSegmentReviewAction={(segment) => void handleSegmentReviewAction(segment)}
        onOpenStageEdit={openStageEdit}
        onMarkSegmentReviewed={(segment) => void handleMarkSegmentReviewed(segment)}
        onDelete={(id, title) => void handleDelete(id, title)}
      />
    ),
    [markReviewedKey, segmentReviewLoadingId, viewSettings],
  )

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <div className="mb-3">
            <Link to="/palaces">
              <Button variant="ghost" size="sm" className="-ml-3">
                <ArrowLeft className="h-4 w-4" />
                返回学科书架
              </Button>
            </Link>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">记忆宫殿</h1>
          {currentSubjectTitle ? (
            <p className="mt-2 text-sm text-muted-foreground">当前书架：{currentSubjectTitle}</p>
          ) : null}
        </div>
        <Link to="/palaces/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            新建宫殿
          </Button>
        </Link>
      </div>

      <PalaceListToolbar
        search={search}
        viewSettings={viewSettings}
        onSearchChange={(value) =>
          setSearchParams((params) => {
            if (value) params.set('search', value)
            else params.delete('search')
            return params
          })
        }
        onClearSearch={() =>
          setSearchParams((params) => {
            params.delete('search')
            return params
          })
        }
        onViewSettingsChange={setViewSettings}
      />

      <PalaceListSections
        groupedData={groupedData}
        hasPalaces={allPalaces.length > 0}
        viewSettings={viewSettings}
        collapsedChapters={collapsedChapters}
        onToggleChapter={(chapterId) =>
          setCollapsedChapters((current) => {
            const next = new Set(current)
            if (next.has(chapterId)) next.delete(chapterId)
            else next.add(chapterId)
            return next
          })
        }
        renderPalaceCard={renderPalaceCard}
      />

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
        onSaveCompletedAt={handleSaveStageCompletedAt}
        onAdvanceToStage={handleAdvanceToStage}
        onRollbackBeforeStage={handleRollbackBeforeStage}
      />
    </div>
  )
}
