import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'

export const QUIZ_RATING_OPTIONS = [
  { rating: 1, label: '忘记', className: 'border-red-400/50 text-red-700 hover:bg-red-500/10 dark:text-red-300' },
  { rating: 2, label: '困难', className: 'border-amber-400/50 text-amber-800 hover:bg-amber-500/10 dark:text-amber-300' },
  { rating: 3, label: '记得', className: 'border-emerald-500/50 text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-300' },
  { rating: 4, label: '轻松', className: 'border-sky-500/50 text-sky-800 hover:bg-sky-500/10 dark:text-sky-300' },
] as const

export function QuizQuestionRatingBar({
  rating,
  disabled = false,
  onRate,
}: {
  rating?: number
  disabled?: boolean
  onRate: (rating: number) => void
}) {
  return (
    <div className="space-y-1.5" data-testid="quiz-question-rating-bar">
      <p className="text-xs text-muted-foreground">评分后记为第一次学习并翻到下一题；改评分不翻页。</p>
      <div className="grid grid-cols-4 gap-1.5">
        {QUIZ_RATING_OPTIONS.map((option) => {
          const selected = rating === option.rating
          return (
            <Button
              key={option.rating}
              type="button"
              size="sm"
              variant={selected ? 'default' : 'outline'}
              disabled={disabled}
              aria-pressed={selected}
              className={cn(!selected && option.className)}
              onClick={() => onRate(option.rating)}
            >
              {option.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
