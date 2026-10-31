import { Flame } from 'lucide-react'
import { useQuizCombo } from '@/modules/quiz/domain/quiz-entity'
import { cn } from '@/shared/lib/utils'
import './quizCombo.css'

const MILESTONES = new Set([5, 10, 20, 30])

/**
 * Quiet streak capsule for answering surfaces. It appears only from two
 * consecutive correct answers: ordinary steps just roll the digit, and a
 * milestone gets one short glow before going still again.
 */
export function QuizComboChip({
  scopeKey,
  className,
}: {
  /** The bank or round this streak belongs to; a new scope starts at zero. */
  scopeKey: string | null
  className?: string
}) {
  const combo = useQuizCombo(scopeKey)
  if (combo < 2) return null
  const milestone = MILESTONES.has(combo)

  return (
    <span
      data-testid="quiz-combo-chip"
      data-combo={combo}
      data-milestone={milestone ? 'true' : undefined}
      className={cn('quiz-combo-chip', className)}
      aria-live="polite"
      aria-label={`连续答对 ${combo} 题`}
      title={`连续答对 ${combo} 题`}
    >
      <Flame className="size-3" aria-hidden />
      <span key={combo} className="quiz-combo-digit">
        {combo}
      </span>
      <span className="quiz-combo-label">连对</span>
    </span>
  )
}
