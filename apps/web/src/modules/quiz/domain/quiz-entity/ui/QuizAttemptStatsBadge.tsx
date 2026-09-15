import { formatQuizAttemptStats } from '@/modules/quiz/domain/quiz-entity/model/quizAttemptStats'
import { Badge } from '@/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'

export function QuizAttemptStatsBadge({
  correctCount,
  attemptCount,
  className,
  variant = 'outline',
}: {
  correctCount: number
  attemptCount: number
  className?: string
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning' | 'info'
}) {
  return (
    <Badge
      variant={variant}
      className={cn('tabular-nums', className)}
      data-testid="quiz-attempt-stats"
      title="历史答对/作答次数"
    >
      {formatQuizAttemptStats(correctCount, attemptCount)}
    </Badge>
  )
}
