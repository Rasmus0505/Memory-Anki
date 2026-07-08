import { History, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getFreestyleHistorySummaryApi,
  getFreestyleQuestionAttemptsApi,
  getFreestyleQuestionExplanationsApi,
} from '@/features/freestyle/api'
import type {
  FreestyleAiExplanationRecord,
  FreestyleCard,
  FreestyleHistoryMode,
  FreestyleHistorySummary,
  FreestyleQuizAttemptRecord,
  FreestyleQuizCard,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { EmptyState } from '@/shared/components/state-placeholders'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

type HistoryTab = 'attempts' | 'explanations'
type HistoryScope = 'all' | 'palace' | 'question'

const EMPTY_SUMMARY: FreestyleHistorySummary = {
  stored: { attempt_count: 0, explanation_count: 0 },
  legacy_quiz: {
    question_count: 0,
    attempted_question_count: 0,
    attempt_count: 0,
    correct_count: 0,
    incorrect_count: 0,
  },
  legacy_ai_logs: {
    total_count: 0,
    explanation_count: 0,
    short_answer_feedback_count: 0,
  },
}

function isQuizCard(card: FreestyleCard | null | undefined): card is FreestyleQuizCard {
  return card?.type === 'quiz_question'
}

function formatDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function answerSummary(record: FreestyleQuizAttemptRecord) {
  const payload = record.answer_payload || {}
  if (typeof payload.selected_option_id === 'string') return `选择：${payload.selected_option_id}`
  if (typeof payload.true_false_answer === 'boolean') return `判断：${payload.true_false_answer ? '对' : '错'}`
  if (typeof payload.user_answer === 'string') return `答案：${payload.user_answer}`
  if (payload.blank_inputs && typeof payload.blank_inputs === 'object') return '填空题答案'
  if (payload.matching_pairs && typeof payload.matching_pairs === 'object') return '匹配题答案'
  if (Array.isArray(payload.ordering_ids)) return '排序题答案'
  if (payload.categorization_assignments && typeof payload.categorization_assignments === 'object') {
    return '归类题答案'
  }
  return '已记录作答'
}

function SummaryStrip({ summary }: { summary: FreestyleHistorySummary }) {
  const legacy = summary.legacy_quiz
  const ai = summary.legacy_ai_logs
  return (
    <div className="grid gap-2 border-b border-border/70 px-5 py-3 text-xs sm:grid-cols-3">
      <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
        <div className="text-muted-foreground">新记录</div>
        <div className="mt-1 font-medium">
          做题 {summary.stored.attempt_count} · 讲解 {summary.stored.explanation_count}
        </div>
      </div>
      <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
        <div className="text-muted-foreground">旧题库统计</div>
        <div className="mt-1 font-medium">
          {legacy.attempted_question_count}/{legacy.question_count} 题 · {legacy.attempt_count} 次
        </div>
      </div>
      <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2">
        <div className="text-muted-foreground">旧 AI 日志</div>
        <div className="mt-1 font-medium">
          {ai.total_count} 条 · 讲解 {ai.explanation_count}
        </div>
      </div>
    </div>
  )
}

function AttemptList({ items }: { items: FreestyleQuizAttemptRecord[] }) {
  if (items.length === 0) {
    return <EmptyState title="还没有做题记录" description="完成题卡后，这里会保存可回看的作答历史。" />
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <article key={item.id} className="rounded-md border border-border/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={item.is_correct === true ? 'success' : item.is_correct === false ? 'destructive' : 'outline'}>
              {item.is_correct === true ? '正确' : item.is_correct === false ? '错误' : '已提交'}
            </Badge>
            <span>{item.mode === 'today' ? '今日训练' : '自由随心'}</span>
            {item.palace_title ? <span>{item.palace_title}</span> : null}
            <span>{formatDate(item.created_at)}</span>
          </div>
          <div className="mt-2 line-clamp-2 text-sm font-medium">{item.stem_snapshot}</div>
          <div className="mt-2 text-sm text-muted-foreground">{answerSummary(item)}</div>
        </article>
      ))}
    </div>
  )
}

function ExplanationList({ items }: { items: FreestyleAiExplanationRecord[] }) {
  if (items.length === 0) {
    return <EmptyState title="还没有 AI 讲解历史" description="在题卡里请求 AI 讲解后，会自动留在这里。" />
  }
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <article key={item.id} className="rounded-md border border-border/70 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {item.palace_title ? <span>{item.palace_title}</span> : null}
            <span>{formatDate(item.created_at)}</span>
            {item.ai_call_log_id ? <Badge variant="outline">AI 日志</Badge> : null}
          </div>
          <div className="mt-2 text-sm font-medium">{item.user_question}</div>
          <div className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {item.explanation_text}
          </div>
        </article>
      ))}
    </div>
  )
}

export function FreestyleHistoryDialog({
  open,
  currentCard,
  currentPalaceId,
  mode,
  onOpenChange,
}: {
  open: boolean
  currentCard: FreestyleCard | null
  currentPalaceId: number | null
  mode: FreestyleHistoryMode
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = useState<HistoryTab>('attempts')
  const [scope, setScope] = useState<HistoryScope>('all')
  const [summary, setSummary] = useState<FreestyleHistorySummary>(EMPTY_SUMMARY)
  const [attempts, setAttempts] = useState<FreestyleQuizAttemptRecord[]>([])
  const [explanations, setExplanations] = useState<FreestyleAiExplanationRecord[]>([])
  const [loading, setLoading] = useState(false)

  const currentQuestionId = isQuizCard(currentCard) ? currentCard.question.id : null
  const query = useMemo(() => {
    if (scope === 'question' && currentQuestionId) return { questionId: currentQuestionId }
    if (scope === 'palace' && currentPalaceId) return { palaceId: currentPalaceId }
    return {}
  }, [currentPalaceId, currentQuestionId, scope])

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      const [nextSummary, list] = await Promise.all([
        getFreestyleHistorySummaryApi(),
        tab === 'attempts'
          ? getFreestyleQuestionAttemptsApi({ ...query, mode, limit: 80 })
          : getFreestyleQuestionExplanationsApi({ ...query, limit: 80 }),
      ])
      setSummary(nextSummary)
      if (tab === 'attempts') {
        setAttempts(list.items as FreestyleQuizAttemptRecord[])
      } else {
        setExplanations(list.items as FreestyleAiExplanationRecord[])
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '加载随心历史失败。')
    } finally {
      setLoading(false)
    }
  }, [mode, query, tab])

  useEffect(() => {
    if (!open) return
    void loadHistory()
  }, [loadHistory, open])

  useEffect(() => {
    if (scope === 'question' && !currentQuestionId) setScope('all')
    if (scope === 'palace' && !currentPalaceId) setScope('all')
  }, [currentPalaceId, currentQuestionId, scope])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-4xl bg-background p-0" floatingId="freestyle-history">
        <DialogHeader>
          <div className="min-w-0">
            <DialogTitle className="flex items-center gap-2">
              <History className="size-4" />
              随心历史
            </DialogTitle>
            <DialogDescription>做题记录和 AI 讲解历史。</DialogDescription>
          </div>
          <DialogClose onClick={() => onOpenChange(false)} />
        </DialogHeader>

        <SummaryStrip summary={summary} />

        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as HistoryTab)}
          className="flex min-h-0 flex-1 flex-col px-5 py-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="attempts">做题记录</TabsTrigger>
                <TabsTrigger value="explanations">AI 讲解</TabsTrigger>
              </TabsList>
            <div className="flex flex-wrap items-center gap-2">
              {(['all', 'palace', 'question'] as const).map((item) => {
                const disabled =
                  (item === 'palace' && !currentPalaceId) ||
                  (item === 'question' && !currentQuestionId)
                const label = item === 'all' ? '全部' : item === 'palace' ? '当前宫殿' : '当前题'
                return (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={scope === item ? 'default' : 'outline'}
                    disabled={disabled}
                    onClick={() => setScope(item)}
                  >
                    {label}
                  </Button>
                )
              })}
              <Button type="button" size="icon" variant="outline" onClick={() => void loadHistory()} aria-label="刷新历史">
                {loading ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              </Button>
            </div>
          </div>

          <TabsContent value="attempts" className={cn('max-h-[48vh] overflow-y-auto pr-1', loading && 'opacity-70')}>
            <AttemptList items={attempts} />
          </TabsContent>
          <TabsContent value="explanations" className={cn('max-h-[48vh] overflow-y-auto pr-1', loading && 'opacity-70')}>
            <ExplanationList items={explanations} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
