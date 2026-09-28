import { formatQuizFontScalePercent } from '@/modules/quiz/domain/quiz-entity/model/quizFontScale'

export function QuizFontScaleHint({ percent, visible }: { percent: number; visible: boolean }) {
  if (!visible) return null
  const label = formatQuizFontScalePercent(percent)
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="quiz-font-scale-hint"
      className="pointer-events-none absolute bottom-16 right-4 z-30 rounded-full bg-foreground/85 px-2.5 py-1 text-xs font-medium tabular-nums text-background shadow-sm"
    >
      {label}
    </div>
  )
}
