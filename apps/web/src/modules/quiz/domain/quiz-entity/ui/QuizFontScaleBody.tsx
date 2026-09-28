import type { ReactNode } from 'react'
import { formatQuizFontScalePercent } from '@/modules/quiz/domain/quiz-entity/model/quizFontScale'

export function QuizFontScaleBody({
  percent,
  children,
}: {
  percent: number
  children: ReactNode
}) {
  return (
    <div
      data-testid="quiz-font-scale-body"
      data-quiz-font-scale-body=""
      className="space-y-3"
      style={{ zoom: formatQuizFontScalePercent(percent) }}
    >
      {children}
    </div>
  )
}
