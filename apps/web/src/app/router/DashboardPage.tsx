import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, Clock3, Plus, Sparkles, Timer, TrendingUp } from 'lucide-react'
import type { DashboardResponse } from '@/shared/api/contracts'
import { TimeRecordDialog } from '@/features/profile/components/TimeRecordDialog'
import { TimeRecordsBreakdownChart } from '@/features/profile/components/TimeRecordsBreakdownChart'
import { TimeRecordsTable } from '@/features/profile/components/TimeRecordsTable'
import { TimeRecordsTrendChart } from '@/features/profile/components/TimeRecordsTrendChart'
import { getTimeRecordChartColor } from '@/features/profile/model/time-record-chart'
import { useTimeRecordsDashboard } from '@/features/profile/hooks/useTimeRecordsDashboard'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Button } from '@/shared/components/ui/button'
import { formatDuration } from '@/entities/session/model'
import { getDashboardApi } from '@/shared/api/modules/dashboard'
import { cn } from '@/shared/lib/utils'

function formatReviewStage(reviewType: string, reviewNumber: number) {
  if (reviewType === '1h') return '首日 1 小时'
  if (reviewType === 'sleep') return '首日睡前'
  return `第 ${reviewNumber + 1} 次`
}

function formatLearningTooltip(item: DashboardResponse['today_learning_palaces'][number]) {
  return [
    `${item.palace_title || '未命名宫殿'}`,
    `总时长：${formatDuration(item.total_seconds)}`,
    `宫殿编辑：${formatDuration(item.palace_edit_seconds)}`,
    `练习：${formatDuration(item.practice_seconds)}`,
    `复习：${formatDuration(item.review_seconds)}`,
  ].join('\n')
}

const dashboardLearningLegend = [
  { key: 'palace_edit', label: '宫殿编辑', color: getTimeRecordChartColor('palace_edit') },
  { key: 'practice', label: '练习', color: getTimeRecordChartColor('practice') },
  { key: 'review', label: '复习', color: getTimeRecordChartColor('review') },
] as const

function buildLearningSegments(item: DashboardResponse['today_learning_palaces'][number]) {
  const rawSegments = [
    { key: 'palace_edit', seconds: item.palace_edit_seconds, color: getTimeRecordChartColor('palace_edit') },
    { key: 'practice', seconds: item.practice_seconds, color: getTimeRecordChartColor('practice') },
    { key: 'review', seconds: item.review_seconds, color: getTimeRecordChartColor('review') },
  ].filter((segment) => segment.seconds > 0)

  const total = Math.max(1, item.total_seconds)
  const minimalUnits = rawSegments.length
  const minPercent = rawSegments.length > 1 ? 6 : 100
  const baseWidths = rawSegments.map((segment) => (segment.seconds / total) * 100)
  const promotedFlags = baseWidths.map((width) => width > 0 && width < minPercent)
  const promotedTotal = promotedFlags.reduce((sum, flag) => sum + (flag ? minPercent : 0), 0)
  const untouchedTotal = baseWidths.reduce((sum, width, index) => sum + (promotedFlags[index] ? 0 : width), 0)
  const remainingPercent = Math.max(0, 100 - promotedTotal)

  return rawSegments.map((segment, index) => {
    const width = promotedFlags[index]
      ? minPercent
      : untouchedTotal > 0
        ? (baseWidths[index] / untouchedTotal) * remainingPercent
        : (100 - minimalUnits * minPercent) / Math.max(1, rawSegments.length)
    return {
      ...segment,
      width,
    }
  })
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null)
  const [hoveredLearningPalaceId, setHoveredLearningPalaceId] = useState<number | null>(null)
  const loadDashboard = useCallback(async () => {
    const dashboard = await getDashboardApi()
    setData(dashboard)
  }, [])
  const timeRecordsDashboard = useTimeRecordsDashboard({
    onRecordsChanged: loadDashboard,
  })

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  if (!data) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">正在加载仪表盘...</div>
  }

  const statCards: Array<{
    label: string
    value: string | number
    icon: typeof BookOpen
    color: string
    link?: string
    linkText?: string
    subtitle?: string
  }> = [
    {
      label: '今日到期',
      value: data.due_count,
      icon: BookOpen,
      color: data.due_count > 0 ? 'text-destructive' : 'text-emerald-500',
      link: '/review',
      linkText: '开始复习',
    },
    {
      label: '今日时长',
      value: formatDuration(data.today_total_review_duration_seconds),
      icon: TrendingUp,
      color: '',
    },
    {
      label: '本周时长',
      value: formatDuration(data.weekly_total_review_duration_seconds),
      icon: Clock3,
      color: '',
    },
    {
      label: '本周复习时长',
      value: formatDuration(data.weekly_formal_review_duration_seconds),
      icon: Timer,
      color: '',
    },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">仪表盘</h1>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon, color, link, linkText, subtitle }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-3xl font-bold ${color}`}>{value}</div>
              {link && data.due_count > 0 ? (
                <Link to={link} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                  {linkText}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              ) : subtitle ? (
                <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div className="space-y-2">
              <CardTitle className="text-base">今日学习</CardTitle>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {dashboardLearningLegend.map((legend) => (
                  <span key={legend.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: legend.color }}
                    />
                    <span>{legend.label}</span>
                  </span>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {data.today_learning_palaces.length > 0 ? (
              <div className="space-y-3">
                {data.today_learning_palaces.map((item) => {
                  const segments = buildLearningSegments(item)
                  const isTooltipVisible = hoveredLearningPalaceId === item.palace_id
                  return (
                    <div key={item.palace_id} className="rounded-xl border border-border/60 bg-background/70 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium">{item.palace_title || '未命名宫殿'}</div>
                        <div className="shrink-0 text-xs text-muted-foreground">{formatDuration(item.total_seconds)}</div>
                      </div>
                      <div className="relative mt-2">
                        <div
                          className="flex h-3 overflow-hidden rounded-full border border-border/60 bg-secondary/80 shadow-inner"
                          onMouseEnter={() => setHoveredLearningPalaceId(item.palace_id)}
                          onMouseLeave={() => setHoveredLearningPalaceId((current) => (current === item.palace_id ? null : current))}
                          onFocus={() => setHoveredLearningPalaceId(item.palace_id)}
                          onBlur={() => setHoveredLearningPalaceId((current) => (current === item.palace_id ? null : current))}
                          tabIndex={0}
                          role="img"
                          aria-label={`${item.palace_title || '未命名宫殿'} 学习时长结构`}
                        >
                          {segments.map((segment) => (
                            <div
                              key={segment.key}
                              className="h-full"
                              style={{
                                width: `${segment.width}%`,
                                backgroundColor: segment.color,
                              }}
                            />
                          ))}
                        </div>
                        {isTooltipVisible ? (
                          <div className="pointer-events-none absolute left-0 top-full z-20 mt-2 min-w-[180px] rounded-2xl border border-border/70 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
                            {formatLearningTooltip(item).split('\n').map((line, index) => (
                              <div
                                key={`${item.palace_id}-${index}`}
                                className={cn(
                                  'whitespace-nowrap',
                                  index === 0 ? 'mb-1 font-medium text-foreground' : 'text-muted-foreground',
                                )}
                              >
                                {line}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">今天还没有产生学习时长记录。</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{`新增章节数量：${data.today_new_palace_count}`}</CardTitle>
            <Link to="/palaces/new">
              <Button size="sm" variant="outline" className="h-8">
                <Plus className="h-3.5 w-3.5" />
                新建
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {data.today_new_palaces.some((subject) => subject.chapter_groups.length > 0 || subject.ungrouped_palaces.length > 0) ? (
              <div className="space-y-4">
                {data.today_new_palaces.map((subjectGroup, subjectIndex) => {
                  const hasAny = subjectGroup.chapter_groups.length > 0 || subjectGroup.ungrouped_palaces.length > 0
                  if (!hasAny) return null
                  const showSubjectTitle = data.today_new_palaces.filter((item) => item.subject).length > 1
                  return (
                    <div key={`${subjectGroup.subject?.id ?? 'ungrouped'}-${subjectIndex}`} className="space-y-2">
                      {showSubjectTitle && subjectGroup.subject ? (
                        <div className="text-xs font-medium text-muted-foreground">{subjectGroup.subject.name}</div>
                      ) : null}
                      {subjectGroup.chapter_groups.map((group) => (
                        <div key={group.source_chapter?.id ?? `group-${subjectIndex}`} className="space-y-1">
                          <div className="text-sm font-semibold">{group.source_chapter?.name ?? '未关联章节'}</div>
                          <div className="space-y-1.5 pl-4">
                            {group.palaces.map((palace) => (
                              <Link
                                key={palace.id}
                                to={`/palaces/${palace.id}/edit`}
                                className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                              >
                                {palace.title || '未命名宫殿'}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                      {subjectGroup.ungrouped_palaces.length > 0 ? (
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-muted-foreground">未关联章节</div>
                          <div className="space-y-1.5 pl-4">
                            {subjectGroup.ungrouped_palaces.map((palace) => (
                              <Link
                                key={palace.id}
                                to={`/palaces/${palace.id}/edit`}
                                className="block truncate rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-secondary active:scale-[0.98]"
                              >
                                  {palace.title || '未命名宫殿'}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                今天还没有新增记忆宫殿。
                <div className="mt-3">
                  <Link to="/palaces/new">
                    <Button variant="outline" size="sm">
                      <Sparkles className="mr-2 h-4 w-4" />
                      创建一个
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <TimeRecordsTrendChart trend={timeRecordsDashboard.trend} />
          <TimeRecordsBreakdownChart
            breakdown={timeRecordsDashboard.breakdown}
          />
        </div>

        <TimeRecordsTable
          thresholdInput={timeRecordsDashboard.thresholdInput}
          onThresholdInputChange={timeRecordsDashboard.setThresholdInput}
          onThresholdBlur={() => void timeRecordsDashboard.applyThreshold()}
          showBelowThreshold={timeRecordsDashboard.showBelowThreshold}
          onShowBelowThresholdChange={timeRecordsDashboard.setShowBelowThreshold}
          keyword={timeRecordsDashboard.keyword}
          onKeywordChange={timeRecordsDashboard.setKeyword}
          kindFilter={timeRecordsDashboard.kindFilter}
          onKindFilterChange={timeRecordsDashboard.setKindFilter}
          showDeleted={timeRecordsDashboard.showDeleted}
          onShowDeletedChange={timeRecordsDashboard.setShowDeleted}
          onCreateRecord={timeRecordsDashboard.openCreateDialog}
          onBulkDelete={() => void timeRecordsDashboard.handleBulkDelete()}
          bulkDeleteDisabled={!timeRecordsDashboard.hasSelectedRecords}
          isBulkDeleting={timeRecordsDashboard.isBulkDeleting}
          deletingRecordId={timeRecordsDashboard.deletingRecordId}
          restoringRecordId={timeRecordsDashboard.restoringRecordId}
          visibleRecords={timeRecordsDashboard.visibleRecords}
          hasSelectableRecords={timeRecordsDashboard.hasSelectableRecords}
          allSelectableChecked={timeRecordsDashboard.allSelectableChecked}
          selectedRecordIds={timeRecordsDashboard.selectedRecordIds}
          onToggleSelectAllVisible={
            timeRecordsDashboard.toggleSelectAllVisible
          }
          onToggleRecordSelection={timeRecordsDashboard.toggleRecordSelection}
          onEditRecord={timeRecordsDashboard.openEditDialog}
          onDeleteRecord={timeRecordsDashboard.handleDeleteRecord}
          onRestoreRecord={timeRecordsDashboard.handleRestoreRecord}
        />
      </div>

      <TimeRecordDialog
        open={timeRecordsDashboard.dialogOpen}
        mode={timeRecordsDashboard.dialogMode}
        form={timeRecordsDashboard.formState}
        error={timeRecordsDashboard.formError}
        isSubmitting={timeRecordsDashboard.isSubmittingRecord}
        onOpenChange={timeRecordsDashboard.onDialogOpenChange}
        onChange={timeRecordsDashboard.onFormChange}
        onSubmit={(event) => void timeRecordsDashboard.handleSubmitRecord(event)}
      />
    </div>
  )
}
