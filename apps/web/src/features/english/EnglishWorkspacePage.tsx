import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  LoaderCircle,
  RefreshCcw,
  ScrollText,
  Trash2,
  Upload,
  Waves,
} from 'lucide-react'
import type { EnglishGenerationTask } from '@/shared/api/contracts'
import { formatDuration } from '@/entities/session/model'
import { EmptyState } from '@/shared/components/state-placeholders'
import { EnglishWorkspaceSkeleton } from './EnglishWorkspaceSkeleton'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/components/ui/sheet'
import { EnglishGenerationLogDialog } from '@/features/english/components/EnglishGenerationLogDialog'
import { EnglishHubReadingTab } from '@/features/english/components/EnglishHubReadingTab'
import { EnglishPatternsPanel } from '@/features/english/components/EnglishPatternsPanel'
import { EnglishVocabularyPanel } from '@/features/english/components/EnglishVocabularyPanel'
import { useEnglishWorkspaceController } from '@/features/english/hooks/useEnglishWorkspaceController'
import {
  EnglishContinueHero,
  EnglishStatStrip,
  EnglishZoneLayout,
  type EnglishHubTab,
} from '@/features/english-shell'

function formatFileSize(bytes: number) {
  const safe = Math.max(0, bytes)
  if (safe >= 1024 * 1024 * 1024) return `${(safe / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (safe >= 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(1)} MB`
  if (safe >= 1024) return `${(safe / 1024).toFixed(1)} KB`
  return `${safe} B`
}

function getTaskStatusLabel(status: EnglishGenerationTask['status']) {
  if (status === 'queued') return '排队中'
  if (status === 'running') return '生成中'
  if (status === 'failed') return '失败'
  if (status === 'completed') return '已完成'
  return '处理中'
}

function getTaskStageLabel(stage: string) {
  const stageMap: Record<string, string> = {
    queued: '等待排队',
    prepare: '准备视频',
    extract_audio: '提取音轨',
    transcribe: '语音转写',
    translate: '生成译文',
    finalize: '整理课程',
    completed: '课程已生成',
    failed: '生成失败',
    interrupted: '服务中断',
  }
  return stageMap[stage] || stage
}

function isInterruptedTask(task: EnglishGenerationTask) {
  return task.status === 'failed' && task.stage === 'interrupted'
}

function parseHubTab(value: string | null): EnglishHubTab {
  if (
    value === 'reading' ||
    value === 'vocab' ||
    value === 'listening' ||
    value === 'patterns'
  ) {
    return value
  }
  return 'listening'
}

export default function EnglishWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseHubTab(searchParams.get('tab'))
  const [importOpen, setImportOpen] = useState(false)
  const {
    actionLoading,
    aiRunConfigDialog,
    canUpload,
    currentTask,
    handleClearTask,
    handleDeleteCourse,
    handleOpenLog,
    handleRetry,
    handleUpload,
    logData,
    logDialogOpen,
    logError,
    logLoading,
    navigateToCourse,
    selectedFile,
    setLogDialogOpen,
    setSelectedFile,
    streamConnected,
    uploading,
    visibleTaskEvents,
    workspace,
  } = useEnglishWorkspaceController()

  const setTab = (next: EnglishHubTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'listening') params.delete('tab')
    else params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

  const headerAside = useMemo(() => {
    if (!workspace) return null
    return (
      <div className="rounded-2xl border border-border/70 bg-card/90 px-4 py-3 text-right shadow-soft">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">今日英语听力</div>
        <div className="mt-1 text-lg font-semibold">
          {formatDuration(workspace.stats.today_practice_seconds)}
        </div>
      </div>
    )
  }, [workspace])

  if (!workspace) {
    return <EnglishWorkspaceSkeleton />
  }

  return (
    <EnglishZoneLayout tab={tab} onTabChange={setTab} headerAside={headerAside}>
      {aiRunConfigDialog}

      {tab === 'listening' ? (
        <div className="space-y-5" data-testid="english-hub-listening-tab">
          {currentTask ? (
            <section className="rounded-3xl border border-border/70 bg-card/95 p-5 shadow-card sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-info">
                    生成任务
                  </div>
                  <h2 className="mt-2 text-lg font-semibold">{currentTask.sourceFilename}</h2>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant={currentTask.status === 'failed' ? 'destructive' : 'secondary'}>
                      {getTaskStatusLabel(currentTask.status)}
                    </Badge>
                    <Badge variant="outline">{getTaskStageLabel(currentTask.stage)}</Badge>
                    <Badge variant={streamConnected ? 'secondary' : 'outline'}>
                      {streamConnected ? (
                        <span className="inline-flex items-center gap-1">
                          <Waves className="h-3.5 w-3.5" />
                          实时流
                        </span>
                      ) : (
                        '轮询回退'
                      )}
                    </Badge>
                    <span>{formatFileSize(currentTask.fileSize)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-semibold tracking-tight">
                    {currentTask.progressPercent}%
                  </div>
                  <div className="text-xs text-muted-foreground">进度</div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-sm">
                {currentTask.message || '正在准备任务'}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, currentTask.progressPercent))}%` }}
                />
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="rounded-xl" onClick={() => void handleOpenLog()}>
                  <ScrollText className="size-4" />
                  完整日志
                </Button>
                {currentTask.status === 'failed' ? (
                  <>
                    <Button
                      size="sm"
                      className="rounded-xl"
                      onClick={() => void handleRetry()}
                      disabled={actionLoading !== null}
                    >
                      <RefreshCcw className="size-4" />
                      {actionLoading === 'retry' ? '重试中…' : '重试'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => void handleClearTask()}
                      disabled={actionLoading !== null}
                    >
                      <Trash2 className="size-4" />
                      {actionLoading === 'clear' ? '清除中…' : '清除'}
                    </Button>
                  </>
                ) : null}
              </div>

              {visibleTaskEvents.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {visibleTaskEvents.slice(0, 3).map((event) => (
                    <div
                      key={event.id}
                      className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-sm"
                    >
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{getTaskStageLabel(event.stage)}</Badge>
                        <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="mt-1">{event.message}</div>
                    </div>
                  ))}
                </div>
              ) : null}

              {currentTask.status === 'failed' ? (
                <div className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  <div className="flex items-center gap-2 font-medium">
                    <CircleAlert className="size-4" />
                    {isInterruptedTask(currentTask) ? '生成被服务重启中断' : '生成失败'}
                  </div>
                  <div className="mt-1.5">
                    {isInterruptedTask(currentTask)
                      ? '点击重试将复用已完成的转写结果，不会重复计费。'
                      : currentTask.errorMessage || '请稍后重试。'}
                  </div>
                </div>
              ) : null}
            </section>
          ) : (
            <EnglishContinueHero
              eyebrow="Continue listening"
              title={
                workspace.continueCourse
                  ? workspace.continueCourse.title
                  : '上传一段视频，开始沉浸听写'
              }
              description={
                workspace.continueCourse
                  ? `已进行到第 ${workspace.continueCourse.currentSentenceIndex + 1} / ${workspace.continueCourse.sentenceCount} 句`
                  : '把英语视频做成逐句拼写练习。生成完成后会自动进入课程。'
              }
              meta={
                workspace.continueCourse ? (
                  <Badge variant="secondary">未完成</Badge>
                ) : (
                  <span>支持常见视频格式</span>
                )
              }
              primaryLabel={workspace.continueCourse ? '继续听写' : '导入视频'}
              onPrimary={() => {
                if (workspace.continueCourse) {
                  navigateToCourse(workspace.continueCourse.id)
                  return
                }
                setImportOpen(true)
              }}
              secondary={
                workspace.continueCourse ? (
                  <Button
                    variant="outline"
                    size="lg"
                    className="min-h-11 rounded-xl"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload className="size-4" />
                    导入新视频
                  </Button>
                ) : null
              }
            />
          )}

          <EnglishStatStrip
            items={[
              { label: '课程', value: workspace.stats.total_courses },
              { label: '未完成', value: workspace.stats.unfinished_courses },
              { label: '累计听力', value: formatDuration(workspace.stats.total_practice_seconds) },
            ]}
          />

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">最近课程</h3>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl"
                onClick={() => setImportOpen(true)}
                disabled={Boolean(currentTask)}
              >
                <Upload className="size-4" />
                导入视频
              </Button>
            </div>

            {workspace.recentCourses.length > 0 ? (
              <div className="space-y-2.5">
                {workspace.recentCourses.map((course) => (
                  <div
                    key={course.id}
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/95 px-4 py-4 shadow-soft sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="truncate text-sm font-medium">{course.title}</div>
                        <Badge variant={course.status === 'completed' ? 'outline' : 'secondary'}>
                          {course.status === 'completed' ? '已完成' : '未完成'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span>{course.sentenceCount} 句</span>
                        <span>{formatDuration(course.durationSeconds)}</span>
                        <span>
                          更新于{' '}
                          {course.updatedAt
                            ? new Date(course.updatedAt).toLocaleString('zh-CN')
                            : '刚刚'}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button asChild className="rounded-xl">
                        <Link to={`/english/courses/${course.id}`}>
                          {course.status === 'completed' ? '再次练习' : '进入课程'}
                          <ArrowRight className="size-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => void handleDeleteCourse(course.id, course.title)}
                        disabled={actionLoading === course.id}
                      >
                        <Trash2 className="size-4" />
                        {actionLoading === course.id ? '删除中…' : '删除'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                variant="list"
                title="还没有英语课程"
                description="上传一段英语视频后，这里会出现历史记录。"
              />
            )}
          </section>
        </div>
      ) : null}

      {tab === 'reading' ? <EnglishHubReadingTab /> : null}
      {tab === 'patterns' ? <EnglishPatternsPanel /> : null}
      {tab === 'vocab' ? <EnglishVocabularyPanel /> : null}

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>导入英语视频</SheetTitle>
            <SheetDescription>
              生成链路会先做 ASR，再翻译成中文译文。完成后会自动进入课程页。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <Input
              type="file"
              accept="video/*"
              disabled={!canUpload}
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            {selectedFile ? (
              <div className="rounded-2xl border border-border/70 bg-muted/40 px-4 py-3 text-sm">
                已选择：{selectedFile.name} · {formatFileSize(selectedFile.size)}
              </div>
            ) : null}
            <Button
              className="min-h-11 w-full rounded-xl"
              onClick={() => void handleUpload()}
              disabled={!selectedFile || !canUpload}
            >
              {uploading ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              {uploading ? '上传中…' : '上传并生成'}
            </Button>
            {!canUpload && currentTask ? (
              <p className="text-xs text-muted-foreground">当前有生成任务进行中，请等待完成或清除后再上传。</p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <EnglishGenerationLogDialog
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        title="英语课程生成日志"
        loading={logLoading}
        error={logError}
        log={logData}
      />
    </EnglishZoneLayout>
  )
}
