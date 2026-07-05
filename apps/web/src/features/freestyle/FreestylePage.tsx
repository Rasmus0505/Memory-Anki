import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Play,
  RotateCcw,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAiRunConfigDialog } from '@/features/ai-config/useAiRunConfigDialog'
import { getFreestyleFeedApi } from '@/features/freestyle/api'
import {
  DEFAULT_FREESTYLE_PROGRESS,
  FREESTYLE_CONTENT_TYPES,
  buildFreestyleQueue,
  buildQueueSignature,
  enabledContentTypes,
  nextFreestyleSeed,
  readFreestyleConfig,
  readFreestyleProgress,
  saveFreestyleConfig,
  saveFreestyleProgress,
  type FreestyleActionFrequency,
  type FreestyleConfig,
  type FreestyleOrderMode,
  type FreestyleProgressSnapshot,
} from '@/features/freestyle/model/freestyle'
import {
  DEFAULT_TODAY_TRAINING_CONFIG,
  EMPTY_TODAY_TRAINING_SOURCES,
  TODAY_TRAINING_ROUND_SIZE,
  buildTodayTrainingQueue,
  buildTodayTrainingSummary,
  nextTodayTrainingSeed,
  readTodayTrainingConfig,
  readTodayTrainingProgress,
  saveTodayTrainingConfig,
  saveTodayTrainingProgress,
  todayFeedContentTypes,
  type FreestyleMode,
  type TodayTrainingConfig,
  type TodayTrainingSummary,
} from '@/features/freestyle/model/today-training'
import { PalaceQuizMemoryLookupDialog } from '@/features/palace-quiz/components/PalaceQuizMemoryLookupDialog'
import { emitReviewConfetti } from '@/shared/components/celebration'
import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/features/palace-quiz/QuizQuestionInteraction'
import { emitQuizResultFeedback } from '@/features/palace-quiz/model/quizResultFeedback'
import {
  recordPalaceQuizChoiceAttemptApi,
  requestPalaceShortAnswerFeedbackApi,
} from '@/features/palace-quiz/api'
import { getPalacesGroupedApi } from '@/entities/palace/api'
import type {
  FreestyleActionCard,
  FreestyleCard,
  FreestyleContentType,
  FreestylePalaceContext,
  FreestyleQuestionTypeFilter,
  FreestyleQuizCard,
  PalaceGroupedItem,
  PalaceGroupedListResponse,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Switch } from '@/shared/components/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/components/ui/tooltip'
import { readTimerAutomationConfig } from '@/shared/components/session/timer-automation-config'
import { useGlobalTimerRegistration } from '@/shared/components/session/GlobalTimerProvider'
import { EmptyState } from '@/shared/components/state-placeholders'
import { dispatchGlobalFeedback } from '@/shared/feedback/globalFeedbackModel'
import {
  getSceneEffectiveVolume,
  readReviewFeedbackSettings,
} from '@/shared/feedback/reviewFeedbackSettings'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'
import { useRouteResidency } from '@/shared/routing/RouteResidency'
import { shouldAutoStartOnPageEnter, useTimedSession } from '@/shared/hooks/useTimedSession'

const CONTENT_TYPE_LABELS: Record<FreestyleContentType, string> = {
  quiz_question: '宫殿题卡',
  review: '正式复习',
  practice: '专项练习',
  english: '英语听力',
  english_reading: '英语阅读',
}

const RANGE_LABELS: Record<FreestyleConfig['range'], string> = {
  all: '全部',
  due: '待复习',
  needs_practice: '需练习',
  specific_palaces: '指定宫殿',
}

const ORDER_MODE_LABELS: Record<FreestyleOrderMode, string> = {
  palace_complete_then_random: '刷完整组再随机',
  random: '全随机',
  sequential: '原始顺序',
}

const ACTION_FREQUENCY_LABELS: Record<FreestyleActionFrequency, string> = {
  none: '不混入',
  low: '低',
  medium: '中',
  high: '高',
}

const MODE_LABELS: Record<FreestyleMode, string> = {
  today: '今日训练',
  free: '自由随心',
}

const QUESTION_TYPE_DISPLAY: Partial<Record<string, string>> = {
  multiple_choice: '选择题',
  true_false: '判断题',
  fill_blank: '填空题',
  matching: '匹配题',
  ordering: '排序题',
  categorization: '归类题',
  short_answer: '简答题',
}

const QUESTION_TYPE_OPTIONS: Array<{ value: FreestyleQuestionTypeFilter; label: string }> = [
  { value: 'all', label: '全部题型' },
  { value: 'multiple_choice', label: '选择题' },
  { value: 'true_false', label: '判断题' },
  { value: 'fill_blank', label: '填空题' },
  { value: 'matching', label: '匹配题' },
  { value: 'ordering', label: '排序题' },
  { value: 'categorization', label: '归类题' },
  { value: 'short_answer', label: '简答题' },
]

function isQuizCard(card: FreestyleCard | null | undefined): card is FreestyleQuizCard {
  return card?.type === 'quiz_question'
}

function isActionCard(card: FreestyleCard | null | undefined): card is FreestyleActionCard {
  return card?.type === 'action'
}

function flattenPalaceOptions(data: PalaceGroupedListResponse | null): FreestylePalaceContext[] {
  if (!data) return []
  const items: PalaceGroupedItem[] = []
  for (const subject of data.subjects || []) {
    for (const group of subject.chapter_groups || []) {
      items.push(...(group.palaces || []))
    }
    items.push(...(subject.ungrouped_palaces || []))
  }
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    resolved_title: item.resolved_title || item.title,
    subject: item.resolved_subject
      ? {
          id: item.resolved_subject.id,
          name: item.resolved_subject.name,
          color: item.resolved_subject.color,
        }
      : null,
    primary_chapter: item.primary_chapter
      ? {
          id: item.primary_chapter.id,
          name: item.primary_chapter.name,
          subject_id: item.primary_chapter.subject_id,
          parent_id: item.primary_chapter.parent_id,
        }
      : null,
    needs_practice: item.needs_practice,
    focus_count: item.focus_count,
  }))
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(mediaQuery.matches)
    sync()
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', sync)
      return () => mediaQuery.removeEventListener('change', sync)
    }
    mediaQuery.addListener(sync)
    return () => mediaQuery.removeListener(sync)
  }, [])

  return reducedMotion
}

function uniquePalaceContexts(cards: FreestyleCard[]) {
  const map = new Map<number, FreestylePalaceContext>()
  cards.forEach((card) => {
    if (!card.palace_context?.id) return
    map.set(card.palace_context.id, card.palace_context)
  })
  return Array.from(map.values()).sort((a, b) => a.id - b.id)
}

function IconButton({
  label,
  children,
  onClick,
  disabled,
}: {
  label: string
  children: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="size-9 rounded-full border border-white/12 bg-zinc-900/84 text-zinc-50 shadow-lg backdrop-blur hover:bg-zinc-800 sm:size-11"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function FreestyleSettingsDialog({
  open,
  config,
  palaceOptions,
  onOpenChange,
  onConfigChange,
}: {
  open: boolean
  config: FreestyleConfig
  palaceOptions: FreestylePalaceContext[]
  onOpenChange: (open: boolean) => void
  onConfigChange: (updater: (current: FreestyleConfig) => FreestyleConfig) => void
}) {
  const selectedPalaceIds = new Set(config.specificPalaceIds)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] max-w-4xl flex-col overflow-hidden rounded-lg border-border/70 bg-background p-0">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>随心设置</DialogTitle>
            <DialogDescription className="mt-1">范围、顺序、题型和跳转卡。</DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm">
              <span className="font-medium">内容范围</span>
              <select
                value={config.range}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    range: event.target.value as FreestyleConfig['range'],
                  }))
                }
              >
                {Object.entries(RANGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">刷题顺序</span>
              <select
                value={config.orderMode}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    orderMode: event.target.value as FreestyleOrderMode,
                  }))
                }
              >
                {Object.entries(ORDER_MODE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">题型</span>
              <select
                value={config.questionType}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    questionType: event.target.value as FreestyleQuestionTypeFilter,
                  }))
                }
              >
                {QUESTION_TYPE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">跳转卡频率</span>
              <select
                value={config.actionFrequency}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) =>
                  onConfigChange((current) => ({
                    ...current,
                    actionFrequency: event.target.value as FreestyleActionFrequency,
                  }))
                }
              >
                {Object.entries(ACTION_FREQUENCY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {FREESTYLE_CONTENT_TYPES.map((type) => (
              <label
                key={type}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 px-3 py-3 text-sm"
              >
                <span>{CONTENT_TYPE_LABELS[type]}</span>
                <Switch
                  checked={config.contentTypes[type]}
                  onCheckedChange={(checked) =>
                    onConfigChange((current) => ({
                      ...current,
                      contentTypes: {
                        ...current.contentTypes,
                        [type]: Boolean(checked),
                      },
                    }))
                  }
                />
              </label>
            ))}
          </div>

          {config.range === 'specific_palaces' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">指定宫殿</div>
              <div className="grid max-h-64 gap-2 overflow-y-auto rounded-lg border border-border/70 p-2 md:grid-cols-2">
                {palaceOptions.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">暂无宫殿</div>
                ) : (
                  palaceOptions.map((palace) => {
                    const checked = selectedPalaceIds.has(palace.id)
                    return (
                      <label
                        key={palace.id}
                        className={cn(
                          'flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-sm',
                          checked ? 'border-primary bg-primary/6' : 'border-border/70 bg-background',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={checked}
                          onChange={(event) => {
                            const nextChecked = event.target.checked
                            onConfigChange((current) => {
                              const currentIds = new Set(current.specificPalaceIds)
                              if (nextChecked) {
                                currentIds.add(palace.id)
                              } else {
                                currentIds.delete(palace.id)
                              }
                              return {
                                ...current,
                                specificPalaceIds: Array.from(currentIds),
                              }
                            })
                          }}
                        />
                        <span className="min-w-0 truncate">
                          {palace.resolved_title || palace.title || `宫殿 ${palace.id}`}
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TodayTrainingSettingsDialog({
  open,
  config,
  onOpenChange,
  onConfigChange,
}: {
  open: boolean
  config: TodayTrainingConfig
  onOpenChange: (open: boolean) => void
  onConfigChange: (updater: (current: TodayTrainingConfig) => TodayTrainingConfig) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-lg border-border/70 bg-background p-0">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle>今日训练设置</DialogTitle>
            <DialogDescription className="mt-1">
              每轮固定 {TODAY_TRAINING_ROUND_SIZE} 个任务，优先处理到期复习。
            </DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <div className="space-y-3 px-5 py-5">
          <label className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 px-3 py-3 text-sm">
            <span>混入英语听力</span>
            <Switch
              checked={config.includeEnglish}
              onCheckedChange={(checked) =>
                onConfigChange((current) => ({
                  ...current,
                  includeEnglish: Boolean(checked),
                }))
              }
            />
          </label>
          <label className="flex items-center justify-between rounded-lg border border-border/70 bg-card/70 px-3 py-3 text-sm">
            <span>混入英语阅读</span>
            <Switch
              checked={config.includeEnglishReading}
              onCheckedChange={(checked) =>
                onConfigChange((current) => ({
                  ...current,
                  includeEnglishReading: Boolean(checked),
                }))
              }
            />
          </label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onConfigChange(() => DEFAULT_TODAY_TRAINING_CONFIG)}>
            恢复默认
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            完成
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FreestyleActionCardView({ card }: { card: FreestyleActionCard }) {
  return (
    <div className="mx-auto flex min-h-[min(720px,calc(100vh-150px))] w-full max-w-3xl flex-col justify-center px-4 py-16">
      <div className="rounded-lg border border-white/12 bg-zinc-900/88 p-5 text-zinc-50 shadow-2xl backdrop-blur sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
              {CONTENT_TYPE_LABELS[card.content_type]}
            </div>
            <h2 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">{card.title}</h2>
            <div className="mt-3 text-sm text-zinc-300">{card.subtitle}</div>
          </div>
          <Badge className="shrink-0 border-amber-300/30 bg-amber-300/10 text-amber-100">
            {card.reason}
          </Badge>
        </div>
        {card.palace_context ? (
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-zinc-300">
            {card.palace_context.resolved_title || card.palace_context.title}
          </div>
        ) : null}
        <Button asChild className="mt-6 w-full sm:w-auto">
          <Link to={card.href}>
            <ExternalLink className="size-4" />
            继续
          </Link>
        </Button>
      </div>
    </div>
  )
}

function FreestyleRoundSummaryCard({
  summary,
  onNextRound,
  onSwitchToFree,
}: {
  summary: TodayTrainingSummary
  onNextRound: () => void
  onSwitchToFree: () => void
}) {
  return (
    <div className="mx-auto flex min-h-[min(720px,calc(100vh-150px))] w-full max-w-3xl flex-col justify-center px-4 py-16">
      <div className="rounded-lg border border-white/12 bg-zinc-900/88 p-5 text-zinc-50 shadow-2xl backdrop-blur sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-300">
              今日训练
            </div>
            <h2 className="mt-3 text-2xl font-semibold leading-tight sm:text-3xl">
              本轮完成
            </h2>
          </div>
          <Badge className="border-emerald-300/30 bg-emerald-300/10 text-emerald-100">
            {formatTimer(summary.durationSeconds)}
          </Badge>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-2xl font-semibold">{summary.totalCount}</div>
            <div className="mt-1 text-xs text-zinc-400">本轮项目</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-2xl font-semibold">{summary.answeredCount}</div>
            <div className="mt-1 text-xs text-zinc-400">已答题</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-2xl font-semibold text-emerald-300">{summary.correctCount}</div>
            <div className="mt-1 text-xs text-zinc-400">答对</div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
            <div className="text-2xl font-semibold text-rose-300">{summary.incorrectCount}</div>
            <div className="mt-1 text-xs text-zinc-400">答错</div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/5 px-3 py-3 text-sm text-zinc-300">
          <div>到期继续卡 {summary.dueActionCount} 个</div>
          <div className="mt-1 text-zinc-400">{summary.suggestion}</div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button type="button" onClick={onNextRound}>
            <Play className="size-4" />
            再来一轮
          </Button>
          <Button type="button" variant="outline" onClick={onSwitchToFree}>
            切到自由随心
          </Button>
        </div>
      </div>
    </div>
  )
}

function FreestyleQuizCardView({
  card,
  state,
  answeredBefore,
  onStateChange,
  onChoiceResolve,
  onShortAnswerSubmit,
  onRequestShortAnswerFeedback,
}: {
  card: FreestyleQuizCard
  state: QuizRuntimeState | undefined
  answeredBefore: boolean
  onStateChange: (updater: (current: QuizRuntimeState) => QuizRuntimeState) => void
  onChoiceResolve: (optionId: string, isCorrect: boolean) => void
  onShortAnswerSubmit: () => void
  onRequestShortAnswerFeedback: () => void
}) {
  const palaceTitle = card.palace_context.resolved_title || card.palace_context.title
  const miniName = card.mini_palace_context?.name
  const chapterName = card.chapter_context?.name
  return (
    <div className="mx-auto flex min-h-[min(760px,calc(100vh-140px))] w-full max-w-4xl flex-col justify-center px-4 py-16">
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-zinc-950 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_12px_40px_rgba(0,0,0,0.62)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="secondary">{palaceTitle}</Badge>
            {miniName ? <Badge variant="outline">{miniName}</Badge> : null}
            {chapterName ? <Badge variant="outline">{chapterName}</Badge> : null}
            <Badge variant="outline">{QUESTION_TYPE_DISPLAY[card.question.question_type] ?? card.question.question_type}</Badge>
          </div>
          <Badge
            variant="outline"
            className={cn(
              'border-zinc-200 bg-zinc-100 text-zinc-500',
              !answeredBefore && 'border-emerald-200 bg-emerald-50 text-emerald-700',
            )}
          >
            {answeredBefore ? '已做过' : '新题'}
          </Badge>
        </div>
        <div className="mt-5 whitespace-pre-wrap text-xl font-semibold leading-8 sm:text-2xl">
          {card.question.stem}
        </div>
        <div className="mt-6">
          <QuizQuestionInteraction
            question={card.question}
            state={state}
            compact
            onStateChange={onStateChange}
            onChoiceResolve={onChoiceResolve}
            onShortAnswerSubmit={onShortAnswerSubmit}
            onRequestShortAnswerFeedback={onRequestShortAnswerFeedback}
          />
        </div>
      </div>
    </div>
  )
}

export default function FreestylePage() {
  const location = useLocation()
  const isMobilePwa =
    location.pathname === '/m' ||
    location.pathname.startsWith('/m/') ||
    location.pathname === '/mobile' ||
    location.pathname.startsWith('/mobile/')
  const { isActive, becameActiveAt } = useRouteResidency()
  const [mode, setMode] = useState<FreestyleMode>('today')
  const [config, setConfig] = useState<FreestyleConfig>(() => readFreestyleConfig())
  const [todayConfig, setTodayConfig] = useState<TodayTrainingConfig>(() => readTodayTrainingConfig())
  const [feedCards, setFeedCards] = useState<FreestyleCard[]>([])
  const [todaySources, setTodaySources] = useState(EMPTY_TODAY_TRAINING_SOURCES)
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [todaySettingsOpen, setTodaySettingsOpen] = useState(false)
  const [memoryLookupOpen, setMemoryLookupOpen] = useState(false)
  const [palaceOptionsData, setPalaceOptionsData] = useState<PalaceGroupedListResponse | null>(null)
  const [progress, setProgress] = useState<FreestyleProgressSnapshot>(() => readTodayTrainingProgress())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Record<string, HTMLElement | null>>({})
  const previousResolvedQuestionIdsRef = useRef<Set<number>>(
    new Set(progress.resolvedQuestionIds),
  )
  const queuePriorityResolvedIdsRef = useRef<number[]>(progress.resolvedQuestionIds)
  const emittedMilestonesRef = useRef<Set<number>>(new Set())
  const reducedMotion = usePrefersReducedMotion()
  const { promptForAiOptions, aiRunConfigDialog } = useAiRunConfigDialog()

  const timer = useTimedSession({
    kind: 'quiz',
    title: '随心模式',
    palaceId: null,
    automationScene: 'freestyle',
    sourceKind: null,
    persistKey: 'freestyle',
  })

  useGlobalTimerRegistration({
    scene: 'freestyle',
    title: '随心模式',
    timer,
    isRouteActive: isActive,
    becameActiveAt,
  })

  const queue = useMemo(
    () => {
      if (mode === 'today') {
        return buildTodayTrainingQueue(todaySources, todayConfig, {
          resolvedQuestionIds: queuePriorityResolvedIdsRef.current,
        })
      }
      return buildFreestyleQueue(feedCards, config, {
        resolvedQuestionIds: queuePriorityResolvedIdsRef.current,
      })
    },
    [config, feedCards, mode, todayConfig, todaySources],
  )
  const queueSignature = useMemo(() => buildQueueSignature(queue), [queue])
  const summaryVisible =
    mode === 'today' &&
    queue.length > 0 &&
    progress.currentIndex >= queue.length
  const currentIndex = summaryVisible
    ? queue.length
    : Math.min(progress.currentIndex, Math.max(0, queue.length - 1))
  const currentCard = queue[currentIndex] ?? null
  const currentPalaceId = currentCard?.palace_context?.id ?? null
  const palaceOptions = useMemo(() => {
    const fromCatalog = flattenPalaceOptions(palaceOptionsData)
    if (fromCatalog.length > 0) return fromCatalog
    return uniquePalaceContexts(feedCards)
  }, [feedCards, palaceOptionsData])

  const setConfigAndPersist = useCallback((updater: (current: FreestyleConfig) => FreestyleConfig) => {
    setConfig((current) => saveFreestyleConfig(updater(current)))
  }, [])

  const setTodayConfigAndPersist = useCallback((updater: (current: TodayTrainingConfig) => TodayTrainingConfig) => {
    setTodayConfig((current) => saveTodayTrainingConfig(updater(current)))
  }, [])

  const setProgressAndPersist = useCallback(
    (updater: (current: typeof progress) => typeof progress) => {
      setProgress((current) => {
        const next = updater(current)
        return mode === 'today'
          ? saveTodayTrainingProgress(next)
          : saveFreestyleProgress(next)
      })
    },
    [mode],
  )

  const loadFeed = useCallback(async (nextConfig: FreestyleConfig) => {
    setFeedLoading(true)
    setFeedError('')
    try {
      const response = await getFreestyleFeedApi({
        range: nextConfig.range,
        palaceIds: nextConfig.specificPalaceIds,
        contentTypes: enabledContentTypes(nextConfig),
      })
      setFeedCards(response.cards || [])
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : '加载随心队列失败。')
    } finally {
      setFeedLoading(false)
    }
  }, [])

  const loadTodayFeed = useCallback(async (nextConfig: TodayTrainingConfig) => {
    setFeedLoading(true)
    setFeedError('')
    try {
      const contentTypes = todayFeedContentTypes(nextConfig)
      const [dueResponse, practiceResponse, fillResponse] = await Promise.all([
        getFreestyleFeedApi({
          range: 'due',
          contentTypes: contentTypes.due,
        }),
        getFreestyleFeedApi({
          range: 'needs_practice',
          contentTypes: contentTypes.practice,
        }),
        getFreestyleFeedApi({
          range: 'all',
          contentTypes: contentTypes.fill,
        }),
      ])
      setTodaySources({
        dueCards: dueResponse.cards || [],
        practiceCards: practiceResponse.cards || [],
        fillCards: fillResponse.cards || [],
      })
      setFeedCards([
        ...(dueResponse.cards || []),
        ...(practiceResponse.cards || []),
        ...(fillResponse.cards || []),
      ])
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : '加载今日训练失败。')
    } finally {
      setFeedLoading(false)
    }
  }, [])

  useEffect(() => {
    if (mode !== 'free') return
    void loadFeed(config)
  }, [mode, config, loadFeed])

  useEffect(() => {
    if (mode !== 'today') return
    void loadTodayFeed(todayConfig)
  }, [mode, todayConfig, loadTodayFeed])

  useEffect(() => {
    let active = true
    void getPalacesGroupedApi()
      .then((data) => {
        if (active) setPalaceOptionsData(data)
      })
      .catch(() => {
        if (active) setPalaceOptionsData(null)
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (feedLoading) return
    if (queue.length === 0 && !feedError) return
    setProgressAndPersist((current) => {
      const maxIndex = mode === 'today' ? queue.length : Math.max(0, queue.length - 1)
      if (current.lastQueueSignature === queueSignature) {
        return {
          ...current,
          currentIndex: Math.min(current.currentIndex, maxIndex),
        }
      }
      return {
        ...current,
        currentIndex: Math.min(current.currentIndex, maxIndex),
        lastQueueSignature: queueSignature,
      }
    })
  }, [feedError, feedLoading, mode, queue.length, queueSignature, setProgressAndPersist])

  useEffect(() => {
    timer.setSceneActive(isActive, { source: isActive ? 'route_active' : 'route_inactive' })
  }, [isActive, timer])

  useEffect(() => {
    if (!isActive) return
    if (timer.status !== 'idle') return
    if (!shouldAutoStartOnPageEnter(readTimerAutomationConfig(), 'freestyle')) return
    timer.start({ source: 'page_enter' })
  }, [isActive, timer])

  useEffect(() => {
    const target = currentCard
      ? cardRefs.current[currentCard.id]
      : summaryVisible
        ? cardRefs.current.__today_summary__
        : null
    target?.scrollIntoView({ block: 'start' })
  }, [currentCard, summaryVisible])

  useEffect(() => {
    const previousResolvedIds = previousResolvedQuestionIdsRef.current
    const nextResolvedIds = new Set(progress.resolvedQuestionIds)
    const newlyResolvedIds = progress.resolvedQuestionIds.filter((id) => !previousResolvedIds.has(id))
    previousResolvedQuestionIdsRef.current = nextResolvedIds

    if (newlyResolvedIds.length === 0) return

    newlyResolvedIds.forEach((questionId) => {
      const state = progress.questionStates[questionId]
      if (!state?.resolved) return
      if (typeof state.correct === 'boolean') {
        emitQuizResultFeedback({ correct: state.correct, reducedMotion })
      } else if (state.shortAnswerSubmitted) {
        dispatchGlobalFeedback('quiz_answer_submit', { label: '提交答案', audioScope: 'local' })
      }
    })

    const latestResolvedId = newlyResolvedIds.at(-1)
    const latestState = latestResolvedId ? progress.questionStates[latestResolvedId] : null
    if (!latestState?.correct) return

    const feedbackSettings = readReviewFeedbackSettings()
    const milestoneSteps = feedbackSettings.scenes.milestone.steps
    const currentStreak = progress.correctStreak
    if (!milestoneSteps.includes(currentStreak) || emittedMilestonesRef.current.has(currentStreak)) {
      return
    }
    emittedMilestonesRef.current.add(currentStreak)
    if (
      feedbackSettings.mode !== 'immersive' ||
      !feedbackSettings.scenes.milestone.enabled
    ) {
      return
    }
    emitReviewConfetti({
      kind: 'milestone',
      confettiAmount: feedbackSettings.scenes.milestone.confettiAmount,
      confettiPreset: feedbackSettings.scenes.milestone.confettiPreset,
      milestoneStep: milestoneSteps.indexOf(currentStreak),
      reducedMotion:
        reducedMotion ||
        feedbackSettings.reducedCelebrationMotion ||
        !feedbackSettings.animationEnabled ||
        !feedbackSettings.scenes.milestone.animationEnabled,
      soundEnabled:
        feedbackSettings.soundEnabled && feedbackSettings.scenes.milestone.soundEnabled,
      volume: getSceneEffectiveVolume(feedbackSettings, 'milestone'),
    })
  }, [
    progress.correctStreak,
    progress.questionStates,
    progress.resolvedQuestionIds,
    reducedMotion,
  ])

  const goToIndex = useCallback(
    (index: number) => {
      if (queue.length === 0) return
      const maxIndex = mode === 'today' ? queue.length : queue.length - 1
      const nextIndex = Math.max(0, Math.min(index, maxIndex))
      timer.registerActivity('practice_interaction', { source: 'freestyle_nav' })
      setProgressAndPersist((current) => ({
        ...current,
        currentIndex: nextIndex,
      }))
    },
    [mode, queue.length, setProgressAndPersist, timer],
  )

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element || queue.length === 0) return
    const nextIndex = Math.max(
      0,
      Math.min(
        mode === 'today' ? queue.length : queue.length - 1,
        Math.round(element.scrollTop / Math.max(1, element.clientHeight)),
      ),
    )
    if (nextIndex === progress.currentIndex) return
    setProgressAndPersist((current) => ({
      ...current,
      currentIndex: nextIndex,
    }))
  }, [mode, progress.currentIndex, queue.length, setProgressAndPersist])

  const updateQuestionState = useCallback(
    (questionId: number, updater: (current: QuizRuntimeState) => QuizRuntimeState) => {
      setProgressAndPersist((current) => {
        const previous = current.questionStates[questionId] || {}
        const nextState = updater(previous)
        const wasResolved = Boolean(previous.resolved)
        const isResolved = Boolean(nextState.resolved)
        const resolvedIds = new Set(current.resolvedQuestionIds)
        let nextStreak = current.correctStreak
        if (!wasResolved && isResolved) {
          resolvedIds.add(questionId)
          if (typeof nextState.correct === 'boolean') {
            nextStreak = nextState.correct ? current.correctStreak + 1 : 0
          }
        }
        return {
          ...current,
          correctStreak: nextStreak,
          resolvedQuestionIds: Array.from(resolvedIds),
          questionStates: {
            ...current.questionStates,
            [questionId]: nextState,
          },
        }
      })
    },
    [setProgressAndPersist],
  )

  const updateFeedQuestion = useCallback((question: FreestyleQuizCard['question']) => {
    setFeedCards((current) =>
      current.map((card) =>
        isQuizCard(card) && card.question.id === question.id
          ? { ...card, question }
          : card,
      ),
    )
  }, [])

  const handleChoiceResolve = useCallback(
    (card: FreestyleQuizCard, optionId: string, isCorrect: boolean) => {
      timer.registerActivity('practice_interaction', { source: 'freestyle_choice' })
      void recordPalaceQuizChoiceAttemptApi(card.question.id, optionId)
        .then((response) => {
          updateFeedQuestion(response.question)
        })
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : '统计刷新失败。')
        })
      if (isCorrect) {
        toast.success('回答正确')
      }
    },
    [timer, updateFeedQuestion],
  )

  const handleShortAnswerFeedback = useCallback(
    async (card: FreestyleQuizCard) => {
      const state = progress.questionStates[card.question.id] || {}
      const userAnswer = state.shortAnswerText?.trim() || ''
      if (!userAnswer) {
        dispatchGlobalFeedback('quiz_error_missing_input', { label: '先写答案', audioScope: 'local' })
        toast.error('请先填写你的答案。')
        return
      }
      dispatchGlobalFeedback('quiz_generate_start', { label: 'AI点评', audioScope: 'global' })
      updateQuestionState(card.question.id, (current) => ({
        ...current,
        shortAnswerFeedbackLoading: true,
      }))
      try {
        const aiOptions = await promptForAiOptions({
          scenarioKey: 'quiz_short_answer_feedback',
          entrypointKey: 'freestyle-short-answer-feedback',
          title: '简答题 AI 点评配置',
        })
        if (!aiOptions) {
          updateQuestionState(card.question.id, (current) => ({
            ...current,
            shortAnswerFeedbackLoading: false,
          }))
          dispatchGlobalFeedback('quiz_generate_cancel', { label: '取消AI', audioScope: 'global' })
          return
        }
        const feedback = await requestPalaceShortAnswerFeedbackApi(card.question.id, userAnswer, aiOptions)
        updateQuestionState(card.question.id, (current) => ({
          ...current,
          shortAnswerFeedback: feedback,
          shortAnswerFeedbackLoading: false,
        }))
        dispatchGlobalFeedback('quiz_result_ai_feedback_ready', { label: 'AI完成', audioScope: 'global' })
      } catch (error) {
        updateQuestionState(card.question.id, (current) => ({
          ...current,
          shortAnswerFeedbackLoading: false,
        }))
        dispatchGlobalFeedback('quiz_error_ai_failed', { label: 'AI失败', audioScope: 'global' })
        toast.error(error instanceof Error ? error.message : 'AI 点评失败。')
      }
    },
    [progress.questionStates, promptForAiOptions, updateQuestionState],
  )

  const handleReshuffle = useCallback(() => {
    queuePriorityResolvedIdsRef.current = progress.resolvedQuestionIds
    if (mode === 'today') {
      setTodayConfigAndPersist((current) => ({
        ...current,
        seed: nextTodayTrainingSeed(current.seed),
      }))
    } else {
      setConfigAndPersist((current) => ({
        ...current,
        seed: nextFreestyleSeed(current.seed),
      }))
    }
    setProgressAndPersist((current) => ({
      ...current,
      currentIndex: 0,
      lastQueueSignature: '',
    }))
    emittedMilestonesRef.current = new Set()
  }, [
    mode,
    progress.resolvedQuestionIds,
    setConfigAndPersist,
    setProgressAndPersist,
    setTodayConfigAndPersist,
  ])

  const switchMode = useCallback((nextMode: FreestyleMode) => {
    if (nextMode === mode) return
    setMode(nextMode)
    const nextProgress = nextMode === 'today' ? readTodayTrainingProgress() : readFreestyleProgress()
    setProgress(nextProgress)
    previousResolvedQuestionIdsRef.current = new Set(nextProgress.resolvedQuestionIds)
    queuePriorityResolvedIdsRef.current = nextProgress.resolvedQuestionIds
    emittedMilestonesRef.current = new Set()
    setFeedError('')
    setFeedLoading(true)
  }, [mode])

  const todaySummary = useMemo(
    () => buildTodayTrainingSummary(queue, progress, timer.effectiveSeconds),
    [progress, queue, timer.effectiveSeconds],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName)
      ) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        goToIndex(currentIndex + 1)
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        goToIndex(currentIndex - 1)
      }
    },
    [currentIndex, goToIndex],
  )

  const answeredQuestionIds = useMemo(
    () => new Set(progress.resolvedQuestionIds),
    [progress.resolvedQuestionIds],
  )
  const quizTotal = queue.filter(isQuizCard).length
  const actionTotal = queue.filter(isActionCard).length
  const resolvedCount = queue.filter(
    (card) => isQuizCard(card) && answeredQuestionIds.has(card.question.id),
  ).length
  const freshCount = Math.max(0, quizTotal - resolvedCount)

  return (
    <TooltipProvider>
      <div
        className={cn(
          'relative overflow-hidden bg-zinc-950 text-zinc-50 shadow-2xl',
          isMobilePwa ? 'min-h-[100dvh] rounded-none' : 'min-h-[calc(100vh-88px)] rounded-lg',
        )}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
      >
        {aiRunConfigDialog}
        <FreestyleSettingsDialog
          open={settingsOpen}
          config={config}
          palaceOptions={palaceOptions}
          onOpenChange={setSettingsOpen}
          onConfigChange={setConfigAndPersist}
        />
        <TodayTrainingSettingsDialog
          open={todaySettingsOpen}
          config={todayConfig}
          onOpenChange={setTodaySettingsOpen}
          onConfigChange={setTodayConfigAndPersist}
        />
        {currentPalaceId ? (
          <PalaceQuizMemoryLookupDialog
            open={memoryLookupOpen}
            onOpenChange={setMemoryLookupOpen}
            currentPalaceId={currentPalaceId}
            followCurrentPalace
          />
        ) : null}

        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-2 px-3 py-3 sm:px-4 sm:py-4">
          {/* 左侧：模式切换 */}
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-zinc-900/80 p-0.5 shadow-lg backdrop-blur">
            <Sparkles className="ml-2 hidden size-3.5 shrink-0 text-amber-300 sm:block" />
            {(['today', 'free'] as const).map((item) => (
              <button
                key={item}
                type="button"
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  mode === item
                    ? 'bg-emerald-300 text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-100',
                )}
                onClick={() => switchMode(item)}
              >
                {MODE_LABELS[item]}
              </button>
            ))}
          </div>

          {/* 右侧：进度 + 连对 + 计时 */}
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-2 text-xs shadow-lg backdrop-blur">
            <span className="tabular-nums text-zinc-300">
              {queue.length === 0
                ? '0/0'
                : summaryVisible
                  ? `${queue.length}/${queue.length}`
                  : `${currentIndex + 1}/${queue.length}`}
            </span>
            {progress.correctStreak > 0 && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="text-emerald-300">🔥{progress.correctStreak}</span>
              </>
            )}
            <span className="text-zinc-600">·</span>
            <Clock3 className="size-3.5 shrink-0 text-zinc-400" />
            <span className="tabular-nums text-zinc-300">
              {timer.status === 'running'
                ? formatTimer(timer.effectiveSeconds)
                : timer.status === 'paused'
                  ? '暂停'
                  : '--:--'}
            </span>
          </div>
        </div>

        <div
          ref={scrollRef}
          className={cn(
            'snap-y snap-mandatory overflow-y-auto overscroll-contain scroll-smooth',
            isMobilePwa ? 'h-[100dvh]' : 'h-[calc(100vh-88px)]',
          )}
          onScroll={handleScroll}
        >
          {feedLoading ? (
            <section className="flex h-full snap-start items-center justify-center">
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <LoaderCircle className="size-4 animate-spin" />
                正在加载随心队列...
              </div>
            </section>
          ) : feedError ? (
            <section className="flex h-full snap-start items-center justify-center px-4">
              <EmptyState
                title="队列加载失败"
                description={feedError}
                action={
                  <Button
                    type="button"
                    onClick={() => {
                      if (mode === 'today') {
                        void loadTodayFeed(todayConfig)
                      } else {
                        void loadFeed(config)
                      }
                    }}
                  >
                    重试
                  </Button>
                }
                className="bg-zinc-900 text-zinc-50 [&_p]:text-zinc-100 [&_p+p]:text-zinc-400"
              />
            </section>
          ) : queue.length === 0 ? (
            <section className="flex h-full snap-start items-center justify-center px-4">
              <EmptyState
                title={mode === 'today' ? '今天暂时没有可训练内容' : '这组暂时刷空了'}
                description={
                  mode === 'today'
                    ? '到期复习、需练习和可补足题卡都暂时为空。'
                    : '当前筛选没有可展示的随心卡，换个范围或重洗队列再来一轮。'
                }
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    {mode === 'today' ? (
                      <Button type="button" variant="secondary" onClick={() => switchMode('free')}>
                        切到自由随心
                      </Button>
                    ) : (
                      <>
                        <Button type="button" variant="secondary" onClick={handleReshuffle}>
                          <Shuffle className="size-4" />
                          重洗
                        </Button>
                        <Button type="button" onClick={() => setSettingsOpen(true)}>
                          <SlidersHorizontal className="size-4" />
                          设置
                        </Button>
                      </>
                    )}
                    <Button asChild variant="outline">
                      <Link to="/palaces/new">{mode === 'today' ? '新建宫殿' : '记忆宫殿'}</Link>
                    </Button>
                  </div>
                }
                className="bg-zinc-900 text-zinc-50 [&_p]:text-zinc-100 [&_p+p]:text-zinc-400"
              />
            </section>
          ) : (
            <>
              {queue.map((card) => (
                <section
                  key={card.id}
                  ref={(node) => {
                    cardRefs.current[card.id] = node
                  }}
                  className="min-h-full snap-start"
                >
                  {isQuizCard(card) ? (
                    <FreestyleQuizCardView
                      card={card}
                      state={progress.questionStates[card.question.id]}
                      answeredBefore={answeredQuestionIds.has(card.question.id)}
                      onStateChange={(updater) => updateQuestionState(card.question.id, updater)}
                      onChoiceResolve={(optionId, isCorrect) => handleChoiceResolve(card, optionId, isCorrect)}
                      onShortAnswerSubmit={() => {
                        timer.registerActivity('practice_interaction', { source: 'freestyle_short_submit' })
                      }}
                      onRequestShortAnswerFeedback={() => void handleShortAnswerFeedback(card)}
                    />
                  ) : (
                    <FreestyleActionCardView card={card} />
                  )}
                </section>
              ))}
              {mode === 'today' ? (
                <section
                  ref={(node) => {
                    cardRefs.current.__today_summary__ = node
                  }}
                  className="min-h-full snap-start"
                >
                  <FreestyleRoundSummaryCard
                    summary={todaySummary}
                    onNextRound={handleReshuffle}
                    onSwitchToFree={() => switchMode('free')}
                  />
                </section>
              ) : null}
            </>
          )}
        </div>

        <div className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 sm:bottom-auto sm:left-auto sm:right-5 sm:top-1/2 sm:-translate-y-1/2 sm:translate-x-0 sm:flex-col">
          <IconButton
            label="设置"
            onClick={() => {
              if (mode === 'today') {
                setTodaySettingsOpen(true)
              } else {
                setSettingsOpen(true)
              }
            }}
          >
            <SlidersHorizontal className="size-5" />
          </IconButton>
          <IconButton
            label="查看宫殿"
            onClick={() => setMemoryLookupOpen(true)}
            disabled={!currentPalaceId}
          >
            <BookOpen className="size-5" />
          </IconButton>
          <IconButton label="上一题" onClick={() => goToIndex(currentIndex - 1)} disabled={currentIndex <= 0}>
            <ChevronUp className="size-5" />
          </IconButton>
          <IconButton
            label="下一题"
            onClick={() => goToIndex(currentIndex + 1)}
            disabled={mode === 'today' ? currentIndex >= queue.length : currentIndex >= queue.length - 1}
          >
            <ChevronDown className="size-5" />
          </IconButton>
          <IconButton label="重洗队列" onClick={handleReshuffle} disabled={queue.length <= 1}>
            <Shuffle className="size-5" />
          </IconButton>
          <IconButton
            label="清空本地进度"
            onClick={() => {
              const nextProgress =
                mode === 'today'
                  ? saveTodayTrainingProgress(DEFAULT_FREESTYLE_PROGRESS)
                  : saveFreestyleProgress(DEFAULT_FREESTYLE_PROGRESS)
              previousResolvedQuestionIdsRef.current = new Set(nextProgress.resolvedQuestionIds)
              emittedMilestonesRef.current = new Set()
              setProgress(nextProgress)
              toast.success('已清空随心进度')
            }}
          >
            <RotateCcw className="size-5" />
          </IconButton>
        </div>

        <div className="pointer-events-none absolute bottom-4 left-4 z-20 hidden items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/80 px-3 py-2 text-xs text-zinc-300 shadow-lg backdrop-blur sm:flex">
          <span className="text-emerald-300">未做 {freshCount}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-400">已做 {resolvedCount}</span>
          <span className="text-zinc-700">·</span>
          <span className="text-amber-300/80">跳转 {actionTotal}</span>
        </div>
      </div>
    </TooltipProvider>
  )
}
