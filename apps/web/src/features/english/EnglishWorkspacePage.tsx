import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookAudio,
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
import { PageIntro } from '@/shared/components/layout/PageIntro'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { EnglishGenerationLogDialog } from '@/features/english/components/EnglishGenerationLogDialog'
import { useEnglishWorkspaceController } from '@/features/english/hooks/useEnglishWorkspaceController'

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
  }
  return stageMap[stage] || stage
}

export default function EnglishWorkspacePage() {
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

  if (!workspace) {
      return (
        <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground">
          正在加载英语听力...
        </div>
      )
  }

  return (
    <div className="space-y-6">
      {aiRunConfigDialog}
      <PageIntro
        title="英语听力"
        description="把英语视频做成沉浸式拼写练习，生成过程现在也能实时追踪。"
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="border-border/70 bg-card/95">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">{currentTask ? '当前生成任务' : '上传英语视频'}</CardTitle>
              </div>
              {currentTask ? (
                <Badge variant={currentTask.status === 'failed' ? 'destructive' : 'secondary'}>
                  {getTaskStatusLabel(currentTask.status)}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {currentTask ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-border/70 bg-background/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="text-lg font-semibold">{currentTask.sourceFilename}</div>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
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
                    <div className="min-w-[120px] text-right">
                      <div className="text-2xl font-semibold">{currentTask.progressPercent}%</div>
                      <div className="text-xs text-muted-foreground">当前进度</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm">
                    {currentTask.message || '正在准备任务'}
                  </div>

                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, currentTask.progressPercent))}%` }}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void handleOpenLog()}>
                      <ScrollText className="mr-2 h-4 w-4" />
                      查看完整日志
                    </Button>
                    {currentTask.status === 'failed' ? (
                      <>
                        <Button size="sm" onClick={() => void handleRetry()} disabled={actionLoading !== null}>
                          <RefreshCcw className="mr-2 h-4 w-4" />
                          {actionLoading === 'retry' ? '重试中...' : '重试'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleClearTask()}
                          disabled={actionLoading !== null}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {actionLoading === 'clear' ? '清除中...' : '清除'}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-3xl border border-border/70 bg-background/70 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">最近关键日志</div>
                    <div className="text-xs text-muted-foreground">
                      课程生成完成后会自动进入练习页
                    </div>
                  </div>
                  {visibleTaskEvents.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {visibleTaskEvents.map((event) => (
                        <div key={event.id} className="rounded-2xl border border-border/70 bg-card px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">{getTaskStageLabel(event.stage)}</Badge>
                            <Badge variant="secondary">{event.kind}</Badge>
                            <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div className="mt-2 text-sm">{event.message}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                      正在等待任务写入第一条日志...
                    </div>
                  )}
                </div>

                {currentTask.status === 'failed' ? (
                  <div className="rounded-3xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                    <div className="flex items-center gap-2 font-medium">
                      <CircleAlert className="h-4 w-4" />
                      生成失败
                    </div>
                    <div className="mt-2">{currentTask.errorMessage || '请稍后重试。'}</div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border/70 bg-background/70 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <Input
                    type="file"
                    accept="video/*"
                    disabled={!canUpload}
                    onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  />
                  <Button onClick={() => void handleUpload()} disabled={!selectedFile || !canUpload}>
                    {uploading ? (
                      <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="mr-2 h-4 w-4" />
                    )}
                    {uploading ? '上传中...' : '上传并生成'}
                  </Button>
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  生成链路会先做 ASR，再直接按返回句子翻译成中文译文，不再额外生成词汇辅助。生成完成后会自动进入课程页。
                </div>
                {selectedFile ? (
                  <div className="mt-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm">
                    已选择：{selectedFile.name} · {formatFileSize(selectedFile.size)}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">英语听力统计</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-xs text-muted-foreground">课程总数</div>
                <div className="mt-2 text-2xl font-semibold">{workspace.stats.total_courses}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-xs text-muted-foreground">未完成课程</div>
                <div className="mt-2 text-2xl font-semibold">{workspace.stats.unfinished_courses}</div>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                <div className="text-xs text-muted-foreground">英语听力总时长</div>
                <div className="mt-2 text-lg font-semibold">{formatDuration(workspace.stats.total_practice_seconds)}</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <CardTitle className="text-base">继续未完成课程</CardTitle>
            </CardHeader>
            <CardContent>
              {workspace.continueCourse ? (
                <div className="rounded-2xl border border-border/70 bg-background/70 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{workspace.continueCourse.title}</div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        已进行到第 {workspace.continueCourse.currentSentenceIndex + 1} / {workspace.continueCourse.sentenceCount} 句
                      </div>
                    </div>
                    <Badge variant="secondary">未完成</Badge>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => navigateToCourse(workspace.continueCourse?.id)}>
                      <BookAudio className="mr-2 h-4 w-4" />
                      继续练习
                    </Button>
                    <Button variant="outline" asChild>
                      <Link to={`/english/courses/${workspace.continueCourse.id}`}>
                        查看课程
                      </Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
                  暂时没有未完成的英语课程。
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-border/70 bg-card/95">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">最近课程</CardTitle>
          <div className="text-xs text-muted-foreground">
            今日英语听力 {formatDuration(workspace.stats.today_practice_seconds)} · 本周 {formatDuration(workspace.stats.weekly_practice_seconds)}
          </div>
        </CardHeader>
        <CardContent>
          {workspace.recentCourses.length > 0 ? (
            <div className="space-y-3">
              {workspace.recentCourses.map((course) => (
                <div
                  key={course.id}
                  className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/70 px-4 py-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium">{course.title}</div>
                      <Badge variant={course.status === 'completed' ? 'outline' : 'secondary'}>
                        {course.status === 'completed' ? '已完成' : '未完成'}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                      <span>{course.sentenceCount} 句</span>
                      <span>{formatDuration(course.durationSeconds)}</span>
                      <span>更新于 {course.updatedAt ? new Date(course.updatedAt).toLocaleString('zh-CN') : '刚刚'}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild>
                      <Link to={`/english/courses/${course.id}`}>
                        {course.status === 'completed' ? '再次练习' : '进入课程'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void handleDeleteCourse(course.id, course.title)}
                      disabled={actionLoading === course.id}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {actionLoading === course.id ? '删除中...' : '删除'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-border/70 py-12 text-center text-sm text-muted-foreground">
              还没有英语课程。上传一段英语视频后，这里会自动出现历史记录。
            </div>
          )}
        </CardContent>
      </Card>

      <EnglishGenerationLogDialog
        open={logDialogOpen}
        onOpenChange={setLogDialogOpen}
        title="英语课程生成日志"
        loading={logLoading}
        error={logError}
        log={logData}
      />
    </div>
  )
}
