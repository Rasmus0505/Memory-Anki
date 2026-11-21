import type {
  PalaceQuizQuestion,
  PalaceQuizQuestionDraft,
  PalaceQuizSourceMeta,
} from '@/shared/api/contracts'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'
import { getQuestionSourceLabel } from '@/modules/quiz/ui/palace-quiz/model/palaceQuizPage'
import { Card, CardContent } from '@/shared/components/ui/card'

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
