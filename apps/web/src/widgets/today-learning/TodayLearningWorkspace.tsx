import { type ReactNode } from 'react'
import {
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  Clock3,
  Command,
  Network,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Target,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DashboardResponse } from '@/shared/api/contracts'
import { formatDuration } from '@/modules/session/public'
import { useDashboardOverview } from '@/modules/dashboard/public'
import { ErrorState, LoadingState } from '@/shared/components/state-placeholders'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'

const numberFormatter = new Intl.NumberFormat('zh-CN')
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, value))
}

function WorkspacePanel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('rounded-xl border border-border/80 bg-card shadow-soft', className)}>
      {children}
    </section>
  )
}

function ContinueLearningPanel({ data }: { data: DashboardResponse }) {
  const activePalace = data.today_learning_palaces[0] ?? null
  const recentPalace = data.recent_palaces[0] ?? null
  const title = activePalace?.palace_title || recentPalace?.title || '建立今天的第一段学习记录'
  const studySeconds = activePalace?.total_seconds ?? 0
  const progress = clampProgress((studySeconds / (45 * 60)) * 100)
  const remainingReviews = data.due_count + data.due_later_today_count

  return (
    <WorkspacePanel>
      <div className="flex items-center gap-2 border-b border-border/70 px-5 py-4 text-sm font-semibold">
        <BrainCircuit className="size-4 text-primary" />
        继续学习
      </div>
      <div className="grid gap-5 p-5 md:grid-cols-[136px_minmax(0,1fr)_168px] md:items-center">
        <div className="relative flex min-h-40 flex-col justify-between overflow-hidden rounded-lg bg-[linear-gradient(145deg,hsl(217_68%_34%),hsl(214_72%_20%))] p-4 text-white shadow-card">
          <div className="absolute -right-8 -top-8 size-28 rounded-full border border-white/15" />
          <div className="absolute -bottom-10 -left-6 size-32 rounded-full border border-white/10" />
          <div className="relative text-xs text-white/70">MEMORY ANKI</div>
          <div className="relative">
            <div className="text-lg font-semibold leading-tight">{activePalace ? '今日主线' : '学习工作台'}</div>
            <div className="mt-2 line-clamp-3 text-xs leading-5 text-white/75">{title}</div>
          </div>
          <Network className="relative size-9 text-sky-200/80" strokeWidth={1.4} />
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h2>
            <span className="text-xs text-muted-foreground">
              {activePalace ? `已学习 ${formatDuration(studySeconds)}` : '等待开始'}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {remainingReviews > 0
              ? `今天还有 ${remainingReviews} 项复习任务，先完成最重要的一轮。`
              : '复习队列已清空，可以开始自由巩固或创建新知识。'}
          </p>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 divide-x divide-border text-sm">
            <div className="pr-4">
              <div className="text-xs text-muted-foreground">待复习</div>
              <div className="mt-1 text-2xl font-semibold">{numberFormatter.format(remainingReviews)}</div>
            </div>
            <div className="px-4">
              <div className="text-xs text-muted-foreground">需练习</div>
              <div className="mt-1 text-2xl font-semibold">{numberFormatter.format(data.needs_practice_count)}</div>
            </div>
            <div className="pl-4">
              <div className="text-xs text-muted-foreground">今日时长</div>
              <div className="mt-1 text-base font-semibold">{formatDuration(data.today_total_review_duration_seconds)}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Button asChild className="h-11 justify-center">
            <Link to="/freestyle">
              <Play className="fill-current" />
              进入随心模式
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-10 justify-center">
            <Link to="/review">
              <Settings2 />
              查看学习选项
            </Link>
          </Button>
        </div>
      </div>
    </WorkspacePanel>
  )
}

function QueuePanel({ data }: { data: DashboardResponse }) {
  const reviews = data.reviews.slice(0, 3)

  return (
    <WorkspacePanel>
      <div className="flex items-center justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold">待复习队列</h2>
          <p className="mt-1 text-xs text-muted-foreground">按到期优先级聚合今天的正式复习。</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/review">开始复习</Link>
        </Button>
      </div>
      <div className="p-3">
        {reviews.length > 0 ? (
          <div className="divide-y divide-border/70">
            {reviews.map((review, index) => {
              const priority = review.overdue_schedule_count > 0 ? '高优先级' : index === 0 ? '中优先级' : '常规'
              const priorityClass = review.overdue_schedule_count > 0
                ? 'border-error/25 bg-error/5 text-error'
                : index === 0
                  ? 'border-warning/30 bg-warning/5 text-warning'
                  : 'border-info/25 bg-info/5 text-info'
              return (
                <Link
                  key={review.id}
                  to={`/review/session/${review.id}`}
                  className="group grid gap-3 px-2 py-3 transition-colors hover:bg-accent/40 sm:grid-cols-[108px_minmax(0,1fr)_96px_72px] sm:items-center"
                >
                  <span className={cn('w-fit rounded border px-2 py-1 text-[11px]', priorityClass)}>{priority}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{review.palace?.title || `宫殿 #${review.palace_id}`}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">下一到期：{review.next_due_date}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{review.schedule_count} 张卡片</span>
                  <span className="inline-flex items-center justify-end gap-1 text-xs font-medium text-primary opacity-70 group-hover:opacity-100">
                    进入 <ArrowRight className="size-3" />
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 rounded-lg bg-secondary/55 px-4 py-5">
            <div>
              <div className="text-sm font-medium">正式复习队列已清空</div>
              <div className="mt-1 text-xs text-muted-foreground">可以继续自由训练，或从知识库选择内容。</div>
            </div>
            <Sparkles className="size-5 text-warning" />
          </div>
        )}
        <Link to="/review" className="mt-2 flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground hover:text-primary">
          查看全部复习（{data.due_count + data.due_later_today_count}）
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </WorkspacePanel>
  )
}

function KnowledgeGraphPanel({ data }: { data: DashboardResponse }) {
  const sources = [
    ...data.today_learning_palaces.map((item) => ({ id: item.palace_id, title: item.palace_title, active: true })),
    ...data.recent_palaces.map((item) => ({ id: item.id, title: item.title, active: false })),
  ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 7)
  const nodes = sources.length > 0 ? sources : [
    { id: 1, title: '开始学习', active: true },
    { id: 2, title: '知识库', active: false },
    { id: 3, title: '复习队列', active: false },
  ]
  const positions = [
    [50, 50], [25, 27], [76, 25], [21, 72], [78, 70], [49, 16], [49, 84],
  ]

  return (
    <WorkspacePanel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Network className="size-4 text-primary" />
          知识图谱
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/knowledge">打开知识库</Link>
        </Button>
      </div>
      <div className="relative h-64 overflow-hidden bg-[radial-gradient(circle_at_center,hsl(214_70%_97%),transparent_70%)] dark:bg-[radial-gradient(circle_at_center,hsl(214_35%_17%),transparent_70%)]">
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {nodes.slice(1).map((node, index) => (
            <line key={node.id} x1="50" y1="50" x2={positions[index + 1][0]} y2={positions[index + 1][1]} stroke="currentColor" className="text-border" strokeWidth="0.5" />
          ))}
        </svg>
        {nodes.map((node, index) => (
          <Link
            key={node.id}
            to={sources.length > 0 ? `/palaces/${node.id}` : '/knowledge'}
            className={cn(
              'absolute max-w-36 -translate-x-1/2 -translate-y-1/2 truncate rounded-md border px-3 py-2 text-xs shadow-soft transition-transform hover:scale-105',
              index === 0 || node.active
                ? 'border-primary/40 bg-primary text-primary-foreground'
                : 'border-border bg-card text-foreground',
            )}
            style={{ left: `${positions[index][0]}%`, top: `${positions[index][1]}%` }}
            title={node.title}
          >
            {node.title}
          </Link>
        ))}
      </div>
    </WorkspacePanel>
  )
}

function OverviewRail({ data }: { data: DashboardResponse }) {
  const totalSeconds = Math.max(data.today_total_review_duration_seconds, 1)
  const learningBreakdown = data.today_learning_palaces.reduce(
    (totals, palace) => ({
      review: totals.review + palace.review_seconds,
      practice: totals.practice + palace.practice_seconds,
      quiz: totals.quiz + palace.quiz_seconds,
      creation: totals.creation + palace.palace_edit_seconds,
    }),
    { review: 0, practice: 0, quiz: 0, creation: 0 },
  )
  const categories = [
    { label: '正式复习', seconds: learningBreakdown.review, color: 'bg-primary' },
    { label: '主动练习', seconds: learningBreakdown.practice, color: 'bg-info' },
    { label: '题目训练', seconds: learningBreakdown.quiz, color: 'bg-warning' },
    { label: '内容创作', seconds: learningBreakdown.creation, color: 'bg-success' },
  ]
  const goals = [
    {
      label: '学习时长',
      current: data.today_total_review_duration_seconds,
      target: 4 * 60 * 60,
      currentText: formatDuration(data.today_total_review_duration_seconds),
      targetText: formatDuration(4 * 60 * 60),
    },
    {
      label: '复习卡片',
      current: data.due_count,
      target: 100,
      currentText: `${data.due_count} 张`,
      targetText: '100 张',
    },
    {
      label: '新学任务',
      current: data.needs_practice_count,
      target: 60,
      currentText: `${data.needs_practice_count} 项`,
      targetText: '60 项',
    },
  ]

  return (
    <aside className="flex flex-col gap-3">
      <WorkspacePanel>
        <div className="flex items-center gap-2 border-b border-border/70 px-4 py-3 text-sm font-semibold">
          <CalendarDays className="size-4 text-primary" />
          今日学习概览
        </div>
        <div className="grid grid-cols-3 divide-x divide-border px-2 py-5 text-center">
          <div className="px-2">
            <div className="text-[11px] text-muted-foreground">学习时长</div>
            <div className="mt-2 text-xl font-semibold">{(data.today_total_review_duration_seconds / 3600).toFixed(1)}</div>
            <div className="text-[11px] text-muted-foreground">小时</div>
          </div>
          <div className="px-2">
            <div className="text-[11px] text-muted-foreground">待复习</div>
            <div className="mt-2 text-xl font-semibold">{data.due_count}</div>
            <div className="text-[11px] text-muted-foreground">项</div>
          </div>
          <div className="px-2">
            <div className="text-[11px] text-muted-foreground">需练习</div>
            <div className="mt-2 text-xl font-semibold">{data.needs_practice_count}</div>
            <div className="text-[11px] text-muted-foreground">项</div>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="text-sm font-semibold">今日时间构成</div>
          <Clock3 className="size-4 text-muted-foreground" />
        </div>
        <div className="space-y-3 px-4 pb-4">
          {categories.map((category) => (
            <div key={category.label}>
              <div className="mb-1 flex justify-between text-[11px]">
                <span className="text-muted-foreground">{category.label}</span>
                <span>{formatDuration(category.seconds)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className={cn('h-full rounded-full', category.color)} style={{ width: `${clampProgress((category.seconds / totalSeconds) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </WorkspacePanel>

      <WorkspacePanel>
        <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Target className="size-4 text-primary" />
            今日目标
          </div>
          <Link to="/profile" className="text-xs text-muted-foreground hover:text-primary">编辑</Link>
        </div>
        <div className="space-y-4 p-4">
          {goals.map((goal) => {
            const progress = clampProgress((goal.current / goal.target) * 100)
            return (
              <div key={goal.label}>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span>{goal.label}</span>
                  <span className="text-muted-foreground">{goal.currentText} / {goal.targetText}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </WorkspacePanel>

      <Link to="/dashboard" className="flex items-center justify-center gap-2 rounded-lg border border-border/70 px-4 py-3 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary">
        查看完整复习分析
        <ArrowRight className="size-3" />
      </Link>
    </aside>
  )
}

export function TodayLearningWorkspace() {
  const { data, error, isLoading, reload } = useDashboardOverview()

  if (isLoading && !data) {
    return <LoadingState text="正在整理今日学习工作台…" />
  }

  if (error && !data) {
    return (
      <ErrorState
        title="今日学习概览加载失败"
        description={error}
        action={<Button onClick={() => void reload()}><RefreshCw />重试</Button>}
      />
    )
  }

  if (!data) return null

  return (
    <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{dateFormatter.format(new Date())}，专注学习，持续进步。</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">今日学习</h1>
        </div>
        <div className="flex items-center gap-2">
          {error ? (
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              <RefreshCw />刷新数据
            </Button>
          ) : null}
          <div className="hidden items-center gap-2 rounded-md border border-border/80 bg-card px-3 py-2 text-xs text-muted-foreground shadow-soft sm:flex">
            <Command className="size-3.5" />
            <span>Ctrl K 全局命令</span>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <ContinueLearningPanel data={data} />
          <QueuePanel data={data} />
          <KnowledgeGraphPanel data={data} />
        </div>
        <OverviewRail data={data} />
      </div>
    </div>
  )
}
