import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BookOpen, ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, type PalaceReviewPlanResponse } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface PalaceListItem {
  id: number
  title: string
  description: string
  mastered: boolean
  next_review_at: string | null
  chapters?: Array<unknown>
}

interface ReviewPlanDayGroup {
  date: string
  items: PalaceReviewPlanResponse['plan']
  completedCount: number
  pendingCount: number
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function formatNextReviewAt(value: string | null): string {
  if (!value) return '未排入正式复习'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未排入正式复习'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-')
}

function formatPlanDate(value: string | null): string {
  if (!value) return '未设置'
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replace(/\//g, '-')
}

function getReviewLabel(reviewNumber: number): string {
  return `第 ${reviewNumber + 1} 次复习`
}

function parsePlanDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}

function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1)
}

function getMonthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date)
}

function getMonthGrid(month: Date): Date[] {
  const start = getMonthStart(month)
  const startWeekday = (start.getDay() + 6) % 7
  const gridStart = new Date(start)
  gridStart.setDate(start.getDate() - startWeekday)

  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart)
    day.setDate(gridStart.getDate() + index)
    return day
  })
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getDayGroup(plan: PalaceReviewPlanResponse['plan']): Map<string, ReviewPlanDayGroup> {
  return plan.reduce((map, item) => {
    if (!item.scheduled_date) return map

    const existing = map.get(item.scheduled_date)
    if (existing) {
      existing.items.push(item)
      existing.completedCount += item.completed ? 1 : 0
      existing.pendingCount += item.completed ? 0 : 1
      return map
    }

    map.set(item.scheduled_date, {
      date: item.scheduled_date,
      items: [item],
      completedCount: item.completed ? 1 : 0,
      pendingCount: item.completed ? 0 : 1,
    })
    return map
  }, new Map<string, ReviewPlanDayGroup>())
}

export default function PalaceList() {
  const [palaces, setPalaces] = useState<PalaceListItem[]>([])
  const [reviewPlan, setReviewPlan] = useState<PalaceReviewPlanResponse | null>(null)
  const [planLoadingId, setPlanLoadingId] = useState<number | null>(null)
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => getMonthStart(new Date()))
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('search') || ''

  const dayGroups = useMemo(() => getDayGroup(reviewPlan?.plan ?? []), [reviewPlan])
  const monthGrid = useMemo(() => getMonthGrid(visibleMonth), [visibleMonth])
  const selectedDayGroup = selectedDate ? dayGroups.get(selectedDate) ?? null : null

  const fetchData = () => {
    const params: Record<string, string> = {}
    if (search) params.search = search
    api.getPalaces(params).then(setPalaces)
  }

  useEffect(() => {
    fetchData()
  }, [searchParams])

  const handleDelete = async (id: number, title: string) => {
    if (!confirm(`确定删除“${title}”吗？此操作无法撤销。`)) return
    await api.deletePalace(id)
    toast.success('已删除')
    fetchData()
  }

  const handleOpenPlan = async (palace: PalaceListItem) => {
    setPlanLoadingId(palace.id)
    try {
      const response = await api.getPalaceReviewPlan(palace.id)
      const firstPlanDate = response.plan.find((item) => item.scheduled_date)?.scheduled_date
      const initialMonth = firstPlanDate ? getMonthStart(parsePlanDate(firstPlanDate)) : getMonthStart(new Date())
      setVisibleMonth(initialMonth)
      setSelectedDate(firstPlanDate ?? null)
      setReviewPlan(response)
    } finally {
      setPlanLoadingId(null)
    }
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
        {palaces.length > 0 ? (
          palaces.map((palace) => (
            <Card key={palace.id} className="transition-shadow hover:shadow-md">
              <CardContent className="flex items-start gap-4 p-5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <Link to={`/palaces/${palace.id}/edit`} className="font-semibold transition-colors hover:text-primary">
                      {palace.title || '未命名宫殿'}
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-xs"
                      onClick={() => void handleOpenPlan(palace)}
                      disabled={planLoadingId === palace.id}
                    >
                      {planLoadingId === palace.id ? '加载中...' : formatNextReviewAt(palace.next_review_at)}
                    </Button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{palace.chapters?.length || 0} 个关联章节</span>
                  </div>
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
                                {group.items.length} 项
                              </span>
                            ) : null}
                          </div>

                          {group ? (
                            <div className="mt-4 space-y-1.5 text-[11px]">
                              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-background/90 px-2 py-1 text-muted-foreground">
                                <span>未完成</span>
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
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">未完成 {selectedDayGroup.pendingCount}</Badge>
                          <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">
                            已完成 {selectedDayGroup.completedCount}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {selectedDayGroup.items.map((item) => (
                          <div key={item.id} className="rounded-xl border border-border/70 bg-background/80 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground">
                                {reviewPlan?.palace_title || '当前宫殿'} · {getReviewLabel(item.review_number)}
                              </div>
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
                            <div className="mt-2 text-xs text-muted-foreground">
                              间隔 {item.interval_days} 天
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">
                      选择一个有任务的日期，查看当天正式复习明细。
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
