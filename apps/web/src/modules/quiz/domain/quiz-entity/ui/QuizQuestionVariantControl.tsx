import { useEffect, useState } from 'react'

import type { PalaceQuizQuestion } from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { toast } from '@/shared/feedback/toast'
import { cn } from '@/shared/lib/utils'

import {
  activatePalaceQuizQuestionVariantApi,
  setPalaceQuizQuestionMutationMarkApi,
} from '../api'
import { QuizQuestionVersionSheet } from './QuizQuestionVersionSheet'

function compactDuration(ms?: number | null): string {
  if (ms == null) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

export function QuizQuestionVariantControl({
  question,
  onQuestionUpdated,
  onAnswerReset,
  compact = false,
  className,
}: {
  question: PalaceQuizQuestion
  onQuestionUpdated?: (question: PalaceQuizQuestion) => void
  onAnswerReset?: (questionId: number) => void
  compact?: boolean
  className?: string
}) {
  const [current, setCurrent] = useState(question)
  const [marking, setMarking] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    setCurrent(question)
  }, [question])

  const activeVersionId = current.active_version_id || 'original'
  const variantCount = current.variant_count || 0
  const needsMutation = Boolean(current.needs_mutation)
  const isVariant = activeVersionId !== 'original'
  const buttonSizeClass = compact ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-xs'

  const applyQuestion = (next: PalaceQuizQuestion) => {
    setCurrent(next)
    onQuestionUpdated?.(next)
  }

  const toggleMark = async () => {
    if (marking) return
    setMarking(true)
    try {
      const response = await setPalaceQuizQuestionMutationMarkApi(
        current.id,
        !needsMutation,
      )
      applyQuestion(response.item)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '更新待换题标记失败。')
    } finally {
      setMarking(false)
    }
  }

  const restoreOriginal = async () => {
    if (restoring || !isVariant) return
    setRestoring(true)
    try {
      const response = await activatePalaceQuizQuestionVariantApi(current.id, 'original')
      applyQuestion(response.item)
      onAnswerReset?.(current.id)
      toast.success('已恢复原始真题。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '恢复原真题失败。')
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      data-testid="quiz-question-variant-control"
      title={`累计作答 ${current.mutation_attempt_count ?? 0} 次 · 连对 ${current.consecutive_correct_count ?? 0} 次 · 最近耗时 ${compactDuration(current.last_answer_duration_ms)}`}
    >
      <Badge
        className={cn(
          'gap-1',
          isVariant
            ? 'border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-200'
            : 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200',
        )}
      >
        {isVariant ? `🧬 AI 变体 · ${activeVersionId}` : '🏛️ 原真题'}
      </Badge>
      {isVariant ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            buttonSizeClass,
            'border-amber-300 text-amber-800 hover:bg-amber-500/10 dark:border-amber-700 dark:text-amber-200',
          )}
          loading={restoring}
          loadingText="恢复中"
          onClick={() => void restoreOriginal()}
        >
          ↺ 恢复真题
        </Button>
      ) : null}
      <Button
        type="button"
        size="sm"
        variant={needsMutation ? 'default' : 'outline'}
        className={cn(
          buttonSizeClass,
          needsMutation
            ? 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700'
            : 'border-amber-500/60 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300',
        )}
        loading={marking}
        loadingText="保存中"
        aria-pressed={needsMutation}
        onClick={() => void toggleMark()}
      >
        {needsMutation ? '🔥 待换题' : '🎯 标记换题'}
      </Button>
      {variantCount > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            buttonSizeClass,
            'border-violet-300 text-violet-800 hover:bg-violet-500/10 dark:border-violet-700 dark:text-violet-200',
          )}
          onClick={() => setHistoryOpen(true)}
        >
          🕒 历史版本 ({variantCount})
        </Button>
      ) : null}
      <QuizQuestionVersionSheet
        question={current}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onQuestionUpdated={applyQuestion}
        onAnswerReset={onAnswerReset}
      />
    </div>
  )
}
