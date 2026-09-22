import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/components/ui/button'

export function QuizQuestionMarkToggle({
  marked,
  disabled = false,
  size = 'sm',
  onToggle,
}: {
  marked: boolean
  disabled?: boolean
  size?: 'default' | 'sm'
  onToggle: (marked: boolean) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="quiz-question-mark-toggle">
      <Button
        type="button"
        size={size}
        variant={marked ? 'default' : 'outline'}
        disabled={disabled}
        aria-pressed={marked}
        className={cn(
          marked
            ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
            : 'border-rose-500/60 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300',
        )}
        onClick={() => onToggle(!marked)}
      >
        {marked ? '取消标记' : '标记'}
      </Button>
      <p className="text-xs text-muted-foreground">标记只改变题号颜色，不安排复习。</p>
    </div>
  )
}
