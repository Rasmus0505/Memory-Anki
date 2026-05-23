import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PalaceStageProgress, formatStageDateTime, toDateTimeLocalValue } from '@/app/router/palace-list/PalaceStageProgress'
import { WEEKDAY_LABELS, formatPlanDate, formatPlanSummary, parsePlanDate, getMonthStart, addMonths, getMonthLabel, getMonthGrid, formatDateKey, getDayGroup } from '@/app/router/palace-list/review-plan'
import { formatDuration } from '@/entities/session/model'
import type {
  PalaceGroupedItem,
  PalaceGroupedListResponse,
  PalaceReviewPlanResponse,
  PalaceSegmentSummary,
  ReviewSessionSubmitResponse,
  ReviewStageSummary,
} from '@/shared/api/contracts'
import {
  deletePalaceApi,
  getPalaceReviewPlanApi,
  getPalacesGroupedApi,
  updateDefaultSegmentReviewProgressApi,
  updatePalaceSegmentReviewProgressApi,
} from '@/shared/api/modules/palaces'
import {
  submitReviewSessionApi,
  submitSegmentReviewSessionApi,
} from '@/shared/api/modules/reviews'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { cn } from '@/shared/lib/utils'

interface StageEditState {
  palaceId: number
  segment: PalaceSegmentSummary
  stage: ReviewStageSummary
}

function ensureSubmitSucceeded(result: ReviewSessionSubmitResponse) {
  if (!result?.ok) {
    throw new Error('复习提交失败')
  }
  return result
}

function formatRelativeReviewTime(value: string | null): string {
  if (!value) return '未排入正式复习'
  const target = new Date(value)
  if (Number.isNaN(target.getTime())) return '未排入正式复习'

  const diffMs = target.getTime() - Date.now()
  if (diffMs <= 0) return '开始复习'

  const totalMinutes = Math.floor(diffMs / (1000 * 60))
  const totalHours = Math.floor(diffMs / (1000 * 60 * 60))
  const totalDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (totalMinutes < 60) {
    return `${Math.max(1, totalMinutes)}分钟`
  }

  if (totalHours < 24) {
    const hours = totalHours
    const minutes = totalMinutes % 60
    return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
  }

  if (totalDays < 30) {
    const days = totalDays
    const hours = totalHours % 24
    return hours > 0 ? `${days}天${hours}小时` : `${days}天`
  }

  const months = Math.floor(totalDays / 30)
  const days = totalDays % 30
  return days > 0 ? `${months}月${days}天` : `${months}天`
}

function formatCreatedAt(value: string | null): string {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replace(/\//g, '-')
}

function getSegmentDisplayName(segment: PalaceSegmentSummary, index: number): string {
  if (segment.display_name) return segment.display_name
  if (segment.is_virtual_default) return '第 1 部分'
  if (/^第\s*1\s*部分$/.test(segment.name)) {
    return `第 ${index + 1} 部分`
  }
  return segment.name
}

export default function PalaceList() {
  const navigate = useNavigate()
  const [groupedData, setGroupedData] = useState<PalaceGroupedListResponse>({ groups: [], ungrouped: [], subjects: [] })
  const [reviewPlan, setReviewPlan] = useState<PalaceReviewPlanResponse | null>(null)
  const [batchReviewPalace, setBatchReviewPalace] = useState<PalaceGroupedItem | null>(null)
  const [selectedBatchSegmentIds, setSelectedBatchSegmentIds] = useState<number[]>([])
  const [planLoadingId, setPlanLoadingId] = useState<number | null>(null)
  const [segmentReviewLoadingId, setSegmentReviewLoadingId] = useState<number | null>(null)
  const [markReviewedKey, setMarkReviewedKey] = useState<string | null>(null)
  const [stageEdit, setStageEdit] = useState<StageEditState | null>(null)
  const [stageCompletedAt, setStageCompletedAt] = useState('')
  const [stageEditError, setStageEditError] = useState<string | null>(null)
  const [stageEditSaving, setStageEditSaving] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => getMonthStart(new Date()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())

  const dayGroups = useMemo(() => getDayGroup(reviewPlan?.plan ?? []), [reviewPlan])
  const monthGrid = useMemo(() => getMonthGrid(visibleMonth), [visibleMonth])
  const selectedDayGroup = selectedDate ? dayGroups.get(selectedDate) ?? null : null

  const fetchData = useCallback(async () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    const data = await getPalacesGroupedApi(params)
    setGroupedData(data)
    return data
  }, [search])

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

  const allPalaces = useMemo(() => {
    return flattenGroupedPalaces(groupedData)
  }, [flattenGroupedPalaces, groupedData])

  useEffect(() => {
    void fetchData()
  }, [fetchData, searchParams])

  const markVirtualDefaultSegmentReviewed = async (palaceId: number) => {
    let latestPalaces = allPalaces
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const palace = latestPalaces.find((item) => item.id === palaceId)
      const defaultSegment = palace?.segments.find((segment) => segment.is_virtual_default)
      const scheduleId = defaultSegment?.current_review_schedule_id
      if (!palace || !defaultSegment?.has_due_review || !scheduleId) {
        break
      }
      ensureSubmitSucceeded(await submitSegmentReviewSessionApi(scheduleId, {
        duration_seconds: 0,
        completion_mode: 'manual_complete',
        revealed_remaining: true,
        red_marked_count: 0,
      }))
      latestPalaces = await fetchData()
    }
  }

  const markSegmentReviewedUntilNotDue = async (
    palaceId: number,
    segmentId: number,
  ) => {
    let latestPalaces = allPalaces
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const palace = latestPalaces.find((item) => item.id === palaceId)
      const segment = palace?.segments.find((item) => item.id === segmentId)
      if (!segment?.has_due_review || !segment.current_review_schedule_id) {
        break
      }
      ensureSubmitSucceeded(await submitSegmentReviewSessionApi(segment.current_review_schedule_id, {
        duration_seconds: 0,
        completion_mode: 'manual_complete',
        revealed_remaining: true,
        red_marked_count: 0,
      }))
      latestPalaces = flattenGroupedPalaces(await fetchData())
    }
  }

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除“${title}”吗？此操作无法撤销。`)) return
    await deletePalaceApi(id)
    toast.success('已删除')
    fetchData()
  }

  const handleOpenPlan = async (palace: PalaceGroupedItem) => {
    setPlanLoadingId(palace.id)
    try {
      const response = await getPalaceReviewPlanApi(palace.id)
      const firstPlanDate = response.plan.find((item) => item.date)?.date
      const initialMonth = firstPlanDate ? getMonthStart(parsePlanDate(firstPlanDate)) : getMonthStart(new Date())
      setVisibleMonth(initialMonth)
      setSelectedDate(firstPlanDate ?? null)
      setReviewPlan(response)
    } finally {
      setPlanLoadingId(null)
    }
  }

  const handleReviewAction = async (palace: PalaceGroupedItem) => {
    if (palace.has_due_review && palace.current_review_schedule_id) {
      navigate(`/review/session/${palace.current_review_schedule_id}`)
      return
    }
    await handleOpenPlan(palace)
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

  const handleMarkPalaceReviewed = async (palace: PalaceGroupedItem) => {
    if (palace.has_due_review && palace.current_review_schedule_id) {
      const requestKey = `palace-${palace.id}`
      setMarkReviewedKey(requestKey)
      try {
        ensureSubmitSucceeded(await submitReviewSessionApi(palace.current_review_schedule_id, {
          duration_seconds: 0,
          completion_mode: 'manual_complete',
          revealed_remaining: true,
          red_marked_count: 0,
        }))
        await fetchData()
        toast.success('已标记为完成本轮复习')
      } catch (error) {
        console.error(error)
        toast.error('标记复习失败，请稍后重试')
      } finally {
        setMarkReviewedKey(null)
      }
      return
    }

    const defaultSegment = palace.segments.find((segment) => segment.is_virtual_default)
    if (!defaultSegment?.has_due_review || !defaultSegment.current_review_schedule_id) return
    const requestKey = `segment-${defaultSegment.id}`
    setMarkReviewedKey(requestKey)
    try {
      await markVirtualDefaultSegmentReviewed(palace.id)
      toast.success('已标记为完成本轮复习')
    } catch (error) {
      console.error(error)
      toast.error('标记复习失败，请稍后重试')
    } finally {
      setMarkReviewedKey(null)
    }
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

  const openStageEdit = (palace: PalaceGroupedItem, segment: PalaceSegmentSummary, stage: ReviewStageSummary) => {
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
    void submitStageProgress(
      stageEdit.stage.review_number,
      null,
      null,
      '复习进度已回退',
    )
  }

  const renderPalaceCard = (palace: PalaceGroupedItem) => {
    const segmentCount = Array.isArray(palace.segments) ? palace.segments.length : 0
    const isMultiSegment = segmentCount > 1
    const hasSingleSegment = segmentCount === 1
    const singleSegment = hasSingleSegment ? palace.segments[0] : null
    const dueBatchSegments = (palace.segments || []).filter(
      (segment) =>
        !segment.is_virtual_default &&
        segment.has_due_review &&
        Boolean(segment.current_review_schedule_id),
    )
    const canBatchReview = dueBatchSegments.length >= 2

    return (
      <Card key={palace.id} className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-start gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <BookOpen className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-start gap-2">
                <Link to={`/palaces/${palace.id}/edit`} className="font-semibold transition-colors hover:text-primary">
                  {palace.resolved_title || palace.title || '未命名宫殿'}
                </Link>
                {canBatchReview ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 text-xs"
                    onClick={() => handleOpenBatchReview(palace)}
                  >
                    开始多块复习
                  </Button>
                ) : null}
              </div>
              {!isMultiSegment && singleSegment ? (
                <Button
                  variant={singleSegment.has_due_review ? 'default' : 'outline'}
                  size="sm"
                  className={cn(
                    'h-8 shrink-0 text-xs',
                    singleSegment.has_due_review && 'bg-emerald-600 text-white hover:bg-emerald-700',
                  )}
                  onClick={() => void handleSegmentReviewAction(singleSegment)}
                  disabled={!singleSegment.current_review_schedule_id || segmentReviewLoadingId === singleSegment.id}
                >
                  {segmentReviewLoadingId === singleSegment.id
                    ? '加载中...'
                    : singleSegment.has_due_review
                      ? '开始复习'
                      : formatRelativeReviewTime(singleSegment.next_review_at)}
                </Button>
              ) : null}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>{formatCreatedAt(palace.created_at)}</span>
              {!isMultiSegment && singleSegment ? <span>预计 {formatDuration(singleSegment.estimated_review_seconds || 0)}</span> : <span>{palace.chapters?.length || 0} 章节</span>}
            </div>
            {!isMultiSegment && singleSegment ? (
              <div className="mt-2">
                <PalaceStageProgress
                  stageLabels={singleSegment.stage_labels}
                  completed={singleSegment.review_stage_completed}
                  stages={singleSegment.review_stages}
                  onStageClick={(stage) => openStageEdit(palace, singleSegment, stage)}
                />
              </div>
            ) : Array.isArray(palace.segments) && palace.segments.length > 0 ? (
              <div className="mt-3 space-y-2.5">
                {palace.segments.map((segment, index) => (
                  <div
                    key={segment.id}
                    className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: segment.color }}
                          />
                          <span className="truncate text-sm font-medium">
                            {getSegmentDisplayName(segment, index)}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>{segment.node_count} 节点</span>
                          <span>预计 {formatRelativeReviewTime(segment.next_review_at)}</span>
                        </div>
                        <PalaceStageProgress
                          stageLabels={segment.stage_labels}
                          completed={segment.review_stage_completed}
                          stages={segment.review_stages}
                          onStageClick={(stage) => openStageEdit(palace, segment, stage)}
                        />
                      </div>
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-[132px]">
                        {isMultiSegment ? (
                          <Button
                            variant={segment.has_due_review ? 'default' : 'outline'}
                            size="sm"
                            className={cn(
                              'h-8 text-xs',
                              segment.has_due_review && 'bg-emerald-600 text-white hover:bg-emerald-700',
                            )}
                            onClick={() =>
                              segment.is_virtual_default
                                ? void handleSegmentReviewAction(segment)
                                : void handleSegmentReviewAction(segment)
                            }
                            disabled={
                              segment.is_virtual_default
                                ? !segment.current_review_schedule_id || segmentReviewLoadingId === segment.id
                                : !segment.current_review_schedule_id || segmentReviewLoadingId === segment.id
                            }
                          >
                            {segmentReviewLoadingId === segment.id
                              ? '加载中...'
                              : segment.has_due_review
                                ? '开始复习'
                              : formatRelativeReviewTime(segment.next_review_at)}
                          </Button>
                        ) : null}
                        {!segment.is_virtual_default ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 w-full text-xs"
                            disabled={!segment.has_due_review || !segment.current_review_schedule_id || markReviewedKey === `segment-${segment.id}`}
                            onClick={() => void handleMarkSegmentReviewed(segment)}
                          >
                            {markReviewedKey === `segment-${segment.id}`
                              ? '提交中...'
                              : '标记已复习'}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <PalaceStageProgress
                stageLabels={palace.stage_labels}
                completed={palace.review_stage_completed}
                stages={palace.review_stages}
              />
            )}
            {palace.description ? (
              <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{palace.description.slice(0, 150)}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {palace.mastered ? <Badge variant="secondary" className="text-[10px]">已掌握</Badge> : null}
            <Link to={`/palaces/${palace.id}/practice`}>
              <Button variant="ghost" size="sm" className="h-8">
                练习
              </Button>
            </Link>
            <Link to={`/palaces/${palace.id}/edit`}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => handleDelete(palace.id, palace.title)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">记忆宫殿</h1>
        </div>
        <Link to="/palaces/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            新建宫殿
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="搜索标题..."
                  value={search}
                  onChange={(event) =>
                    setSearchParams((params) => {
                      if (event.target.value) params.set('search', event.target.value)
                      else params.delete('search')
                      return params
                    })
                  }
                  className="pl-9"
                />
              </div>
            </div>
            {search ? (
              <Button variant="ghost" size="sm" onClick={() => setSearchParams({})}>
                清除搜索
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {allPalaces.length > 0 ? (
          groupedData.subjects.map((subject) => (
            <div key={subject.subject?.id ?? 'ungrouped'}>
              {subject.subject ? (
                <h2 className="mb-2 text-lg font-semibold text-foreground">
                  <span
                    className="mr-2 inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: subject.subject.color }}
                  />
                  {subject.subject.name}
                </h2>
              ) : null}
              {subject.chapter_groups.map((group) => {
                const chapterId = group.source_chapter?.id
                const isCollapsed = chapterId != null && collapsedChapters.has(chapterId)
                return (
                <div key={chapterId ?? 'no-chapter'} className="mb-3">
                  {group.source_chapter ? (
                    <button
                      type="button"
                      className="mb-1 ml-2 flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        if (chapterId == null) return
                        setCollapsedChapters((prev) => {
                          const next = new Set(prev)
                          if (next.has(chapterId)) next.delete(chapterId)
                          else next.add(chapterId)
                          return next
                        })
                      }}
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                      {group.source_chapter.name}
                    </button>
                  ) : null}
                  {!isCollapsed ? (
                    <div className="space-y-3">
                      {group.palaces.map((palace) => renderPalaceCard(palace))}
                    </div>
                  ) : null}
                </div>
              )})}
              {subject.ungrouped_palaces.length > 0 ? (
                <div className="space-y-3">
                  {subject.ungrouped_palaces.map((palace) => renderPalaceCard(palace))}
                </div>
              ) : null}
            </div>
          ))
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center p-12 text-center">
              <BookOpen className="mb-4 h-12 w-12 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">还没有记忆宫殿。</p>
              <Link to="/palaces/new" className="mt-2">
                <Button variant="outline" size="sm">
                  <Plus className="h-4 w-4" />
                  创建第一个
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={batchReviewPalace !== null}
        onOpenChange={(open) => {
          if (!open) {
            setBatchReviewPalace(null)
            setSelectedBatchSegmentIds([])
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div>
              <DialogTitle>开始多块复习</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {batchReviewPalace?.title || '当前宫殿'} 中当前到期的分块会合并成一张思维导图，一次完成复习。
              </p>
            </div>
            <DialogClose
              onClick={() => {
                setBatchReviewPalace(null)
                setSelectedBatchSegmentIds([])
              }}
            />
          </DialogHeader>
          <div className="space-y-3 p-1">
            {batchReviewPalace?.segments
              ?.filter(
                (segment) =>
                  !segment.is_virtual_default &&
                  segment.has_due_review &&
                  Boolean(segment.current_review_schedule_id),
              )
              .map((segment, index) => {
                const checked = selectedBatchSegmentIds.includes(segment.id)
                return (
                  <label
                    key={segment.id}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-border/70 bg-background/80 px-4 py-3 transition-colors hover:border-primary/40 hover:bg-accent/30"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-input"
                      checked={checked}
                      onChange={(event) => handleToggleBatchSegment(segment.id, event.target.checked)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: segment.color }}
                        />
                        <span className="truncate text-sm font-medium">
                          {getSegmentDisplayName(segment, index)}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{segment.node_count} 节点</span>
                        <span>预计 {formatRelativeReviewTime(segment.next_review_at)}</span>
                        <span>{segment.estimated_review_seconds || 0} 秒</span>
                      </div>
                    </div>
                  </label>
                )
              })}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              已选择 {selectedBatchSegmentIds.length} 个分块
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setBatchReviewPalace(null)
                  setSelectedBatchSegmentIds([])
                }}
              >
                取消
              </Button>
              <Button onClick={handleStartBatchReview} disabled={selectedBatchSegmentIds.length === 0}>
                开始复习
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={stageEdit !== null} onOpenChange={(open) => !open && setStageEdit(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div>
              <DialogTitle>
                {stageEdit?.segment ? `${getSegmentDisplayName(stageEdit.segment, 0)} · ${stageEdit.stage.label}` : '复习节点'}
              </DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {stageEdit?.stage.completed
                  ? `完成于 ${formatStageDateTime(stageEdit.stage.completed_at)}`
                  : `预计 ${formatStageDateTime(stageEdit?.stage.scheduled_at ?? null)}`}
              </p>
            </div>
            <DialogClose onClick={() => setStageEdit(null)} />
          </DialogHeader>

          <div className="space-y-4 p-6">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">完成时间</span>
              <Input
                type="datetime-local"
                value={stageCompletedAt}
                onChange={(event) => setStageCompletedAt(event.target.value)}
              />
            </label>

            {stageEditError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {stageEditError}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setStageEdit(null)}
                disabled={stageEditSaving}
              >
                取消
              </Button>
              {stageEdit?.stage.completed ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRollbackBeforeStage}
                    disabled={stageEditSaving}
                  >
                    退回到此节点前
                  </Button>
                  <Button
                    type="button"
                    onClick={handleSaveStageCompletedAt}
                    disabled={stageEditSaving}
                  >
                    保存时间
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={handleAdvanceToStage}
                  disabled={stageEditSaving}
                >
                  前进到此节点
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewPlan !== null} onOpenChange={(open) => !open && setReviewPlan(null)}>
        <DialogContent className="max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <div>
              <DialogTitle>{reviewPlan?.palace_title || '正式复习计划'}</DialogTitle>
            </div>
            <DialogClose onClick={() => setReviewPlan(null)} />
          </DialogHeader>
          <div className="max-h-[64vh] overflow-y-auto p-6">
            {reviewPlan?.plan.length ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-border/70 bg-card/80 p-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-xl"
                      onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="text-sm font-semibold text-foreground">{getMonthLabel(visibleMonth)}</div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-9 w-9 rounded-xl"
                      onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {WEEKDAY_LABELS.map((label) => (
                      <div
                        key={label}
                        className="px-2 py-1 text-center text-[11px] font-medium tracking-wide text-muted-foreground"
                      >
                        {label}
                      </div>
                    ))}

                    {monthGrid.map((day) => {
                      const dayKey = formatDateKey(day)
                      const group = dayGroups.get(dayKey)
                      const isCurrentMonth = day.getMonth() === visibleMonth.getMonth()
                      const isSelected = selectedDate === dayKey
                      const isAllCompleted = !!group && group.pendingCount === 0

                      return (
                        <button
                          key={dayKey}
                          type="button"
                          onClick={() => group && setSelectedDate(dayKey)}
                          disabled={!group}
                          className={cn(
                            'min-h-[102px] rounded-2xl border p-2 text-left align-top transition-colors',
                            group
                              ? 'cursor-pointer border-border/70 bg-background hover:border-primary/40 hover:bg-accent/40'
                              : 'cursor-default border-dashed border-border/60 bg-muted/20',
                            isSelected && 'border-primary bg-primary/5 shadow-sm',
                            isAllCompleted && 'border-emerald-200 bg-emerald-50/90',
                            !isCurrentMonth && 'opacity-45',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className={cn(
                                'text-sm font-medium',
                                isCurrentMonth ? 'text-foreground' : 'text-muted-foreground',
                              )}
                            >
                              {day.getDate()}
                            </span>
                            {group ? (
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                  isAllCompleted
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-secondary text-secondary-foreground',
                                )}
                              >
                                1 个复习对象
                              </span>
                            ) : null}
                          </div>

                          {group ? (
                          <div className="mt-4 space-y-1.5 text-[11px]">
                            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/90 px-2 py-1 text-muted-foreground">
                                <span>待复习</span>
                                <span>{group.pendingCount}</span>
                              </div>
                              <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-2 py-1 text-emerald-700">
                                <span>已完成</span>
                                <span>{group.completedCount}</span>
                              </div>
                            </div>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-card/80 p-4">
                  {selectedDayGroup ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-foreground">
                            {formatPlanDate(selectedDayGroup.date)}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            当日复习对象
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">待复习 {selectedDayGroup.pendingCount}</Badge>
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            已完成 {selectedDayGroup.completedCount}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {selectedDayGroup.items.map((item) => (
                          <div key={item.representative_schedule_id} className="rounded-xl border border-border/70 bg-background/80 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground">
                                {reviewPlan?.palace_title || '当前宫殿'}
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  className={cn(
                                    item.completed
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-border/80 bg-background text-muted-foreground',
                                  )}
                                >
                                  {item.completed ? '已完成' : '未完成'}
                                </Badge>
                              </div>
                            </div>
                            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                              <div>{formatPlanSummary(item)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
                      选择一个有任务的日期，查看当天正式复习安排。
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                这个宫殿暂时还没有正式复习计划。
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
