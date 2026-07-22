import { RotateCcw } from 'lucide-react'
import {
  QuizQuestionInteraction,
  type QuizRuntimeState,
} from '@/modules/quiz/domain/quiz-entity'
import type {
  ChapterTreeNode,
} from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import {
  getQuestionOwnershipLabel,
  getQuestionSourceLabel,
  getQuestionTypeLabel,
} from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import type {
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizSourceMeta,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { cn } from '@/shared/lib/utils'

export function PreviewQuestionAnswerSummary({ question }: { question: PalaceQuizQuestionDraft }) {
  if (question.question_type === 'multiple_choice') {
    return (
      <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
        {(question.options || []).map((option) => (
          <div key={option.id}>
            {option.id}. {option.text}
            {question.answer_payload.correct_option_id === option.id ? '（正确）' : ''}
          </div>
        ))}
      </div>
    )
  }
  if (question.question_type === 'short_answer') {
    return (
      <div className="mt-2 text-sm text-muted-foreground">
        参考答案：{question.answer_payload.reference_answer || '暂无'}
      </div>
    )
  }
  if (question.question_type === 'true_false') {
    return (
      <div className="mt-2 text-sm text-muted-foreground">
        正确答案：{question.answer_payload.correct_answer ? '对' : '错'}
      </div>
    )
  }
  if (question.question_type === 'fill_blank') {
    return (
      <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
        {(question.answer_payload.blanks || []).map((blank) => (
          <div key={blank.id}>
            {blank.id}：{blank.answer}
          </div>
        ))}
      </div>
    )
  }
  if (question.question_type === 'matching') {
    return (
      <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
        {(question.answer_payload.pairs || []).map((pair) => (
          <div key={`${pair.left_id}_${pair.right_id}`}>
            {pair.left} → {pair.right}
          </div>
        ))}
      </div>
    )
  }
  if (question.question_type === 'ordering') {
    return (
      <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
        {(question.answer_payload.items || []).map((item) => (
          <div key={item.id}>
            {item.id}. {item.text}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="mt-2 space-y-1.5 text-sm text-muted-foreground">
      {(question.answer_payload.categories || []).map((category) => (
        <div key={category.id}>{category.name}</div>
      ))}
    </div>
  )
}

export function QuestionSourceBadge({
  sourceMeta,
  compact = false,
}: {
  sourceMeta?: PalaceQuizSourceMeta | null
  compact?: boolean
}) {
  if (!sourceMeta) {
    return <Badge variant="outline">手工录入</Badge>
  }

  return (
    <details className={cn('group', compact ? 'text-[11px]' : 'text-xs')}>
      <summary className="list-none">
        <Badge variant="outline" className="cursor-pointer">
          {getQuestionSourceLabel(sourceMeta)}
        </Badge>
      </summary>
      <div className="mt-2 space-y-1 rounded-xl border border-border/70 bg-background/80 px-3 py-2 text-muted-foreground">
        <div>来源：{getQuestionSourceLabel(sourceMeta)}</div>
        {sourceMeta.page_numbers?.length ? <div>页码：{sourceMeta.page_numbers.join(', ')}</div> : null}
        {sourceMeta.image_names?.length ? <div>图片：{sourceMeta.image_names.join(', ')}</div> : null}
        {sourceMeta.extra_prompt ? <div>提示词：{sourceMeta.extra_prompt}</div> : null}
        {sourceMeta.ai_call_log_id ? <div>AI日志 {sourceMeta.ai_call_log_id}</div> : null}
      </div>
    </details>
  )
}

export function PreviewQuestionCard({
  question,
  index,
}: {
  question: PalaceQuizQuestionDraft
  index: number
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/70 px-3 py-3">
      <div className="mb-2 flex items-center gap-1.5">
        <Badge variant="secondary">#{index + 1}</Badge>
        <Badge variant="outline">{getQuestionTypeLabel(question.question_type)}</Badge>
      </div>
      <div className="text-sm font-medium leading-6">{question.stem}</div>
      <PreviewQuestionAnswerSummary question={question} />
      <div className="mt-2.5 text-sm text-muted-foreground">
        解析：{question.analysis || '暂无解析'}
      </div>
    </div>
  )
}

export function ChapterRangeTree({
  node,
  allowedChapterIds,
  selectedChapterId,
  onSelect,
  depth,
}: {
  node: ChapterTreeNode
  allowedChapterIds: Set<number>
  selectedChapterId: number | null
  onSelect: (chapterId: number) => void
  depth: number
}) {
  const isAllowed = allowedChapterIds.has(node.id)
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={!isAllowed}
        onClick={() => isAllowed && onSelect(node.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm',
          isAllowed
            ? selectedChapterId === node.id
              ? 'border-primary/40 bg-primary/10 text-foreground'
              : 'border-border/70 bg-background hover:border-primary/30'
            : 'cursor-not-allowed border-border/50 bg-background/50 text-muted-foreground opacity-60',
        )}
        style={{ marginLeft: `${depth * 16}px` }}
      >
        <span>{selectedChapterId === node.id ? '●' : '○'}</span>
        <span>{node.name}</span>
      </button>
      {(node.children || []).map((child) => (
        <ChapterRangeTree
          key={child.id}
          node={child}
          allowedChapterIds={allowedChapterIds}
          selectedChapterId={selectedChapterId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}

interface QuizQuestionCardProps {
  question: PalaceQuizQuestion
  state: QuizRuntimeState | undefined
  compact?: boolean
  onChoiceSelect: (question: PalaceQuizQuestion, optionId: string) => void
  onStateChange: (
    questionId: number,
    updater: (current: QuizRuntimeState) => QuizRuntimeState,
  ) => void
  onShortAnswerSubmit: (questionId: number) => void
  onShortAnswerFeedback: (question: PalaceQuizQuestion) => void
  onReset: (questionId: number) => void
  onEdit: (question: PalaceQuizQuestion) => void
}

export function QuizQuestionCard({
  question,
  state,
  compact = false,
  onChoiceSelect,
  onStateChange,
  onShortAnswerSubmit,
  onShortAnswerFeedback,
  onReset,
  onEdit,
}: QuizQuestionCardProps) {
  return (
    <Card className="border-border/70 bg-card/92">
      <CardHeader
        className={cn(
          'flex flex-row items-start justify-between gap-3',
          compact ? 'px-4 py-4' : '',
        )}
      >
        <div className={cn(compact ? 'space-y-1.5' : 'space-y-2')}>
          <div className={cn('flex flex-wrap items-center', compact ? 'gap-1.5' : 'gap-2')}>
            <Badge variant="outline">{getQuestionTypeLabel(question.question_type)}</Badge>
            <Badge variant={!(question.segment_ids?.length) ? 'secondary' : 'outline'}>
              {getQuestionOwnershipLabel(question)}
            </Badge>
            <QuestionSourceBadge sourceMeta={question.source_meta} compact={compact} />
            {question.question_type === 'multiple_choice' ? (
              <span className={cn('text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
                答对 {question.correct_count} 次 / 答错 {question.incorrect_count} 次
              </span>
            ) : null}
          </div>
          <CardTitle className={cn(compact ? 'text-sm leading-6' : 'text-base leading-7')}>
            {question.stem}
          </CardTitle>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={compact ? 'h-8 px-2.5' : ''}
          onClick={() => onEdit(question)}
        >
          编辑
        </Button>
      </CardHeader>
      <CardContent className={cn(compact ? 'space-y-3 px-4 pb-4 pt-0' : 'space-y-4')}>
        <QuizQuestionInteraction
          question={question}
          state={state}
          compact={compact}
          onStateChange={(updater) => onStateChange(question.id, updater)}
          onChoiceResolve={(optionId) => onChoiceSelect(question, optionId)}
          onShortAnswerSubmit={() => onShortAnswerSubmit(question.id)}
          onRequestShortAnswerFeedback={() => void onShortAnswerFeedback(question)}
        />

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onReset(question.id)}>
            <RotateCcw className="size-4" />
            再做一次
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
