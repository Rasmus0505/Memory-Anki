import type { PalaceQuizQuestion, PalaceQuizQuestionDraft } from '@/shared/api/contracts'
import { cn } from '@/shared/lib/utils'
import { quizDisplayStem } from '@/modules/quiz/domain/quiz-entity/model/quizAnswerMode'
import { useQuizAnswerMode } from '@/modules/quiz/domain/quiz-entity/ui/useQuizAnswerMode'

export function QuizQuestionStem({
  question,
  className,
}: {
  question: PalaceQuizQuestion | PalaceQuizQuestionDraft
  className?: string
}) {
  const { mode } = useQuizAnswerMode()
  return (
    <span className={cn('whitespace-pre-wrap', className)}>
      {quizDisplayStem(question, mode) || '（题干为空）'}
    </span>
  )
}
