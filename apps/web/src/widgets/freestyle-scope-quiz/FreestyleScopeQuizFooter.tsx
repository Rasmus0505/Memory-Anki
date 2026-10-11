import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { Button } from '@/shared/components/ui/button'

export function FreestyleScopeQuizFooter({
  questionCount,
  answeredCount,
  index,
  currentState,
  scopeLabel,
  goToIndex,
  onFinish,
}: {
  questionCount: number
  answeredCount: number
  index: number
  currentState: QuizRuntimeState
  scopeLabel: string
  goToIndex: (nextIndex: number) => void
  onFinish: () => void
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
      <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
        {questionCount > 1
          ? `已答 ${answeredCount} / ${questionCount} · ${scopeLabel}`
          : currentState.resolved
            ? '已作答'
            : '待作答'}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        {currentState.resolved && index < questionCount - 1 ? (
          <span className="shrink-0 text-xs text-muted-foreground">Enter 下一题</span>
        ) : null}
        {questionCount > 1 ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="上一题"
              disabled={index <= 0}
              onClick={() => goToIndex(Math.max(0, index - 1))}
            >
              <ChevronLeft className="size-4" />
              上一题
            </Button>
            <Button
              type="button"
              size="sm"
              variant={currentState.resolved ? 'default' : 'outline'}
              aria-label="下一题"
              disabled={index >= questionCount - 1}
              onClick={() => goToIndex(Math.min(questionCount - 1, index + 1))}
            >
              下一题
              <ChevronRight className="size-4" />
            </Button>
          </>
        ) : null}
        {index >= questionCount - 1 && currentState.resolved ? (
          <Button type="button" size="sm" onClick={onFinish}>
            <Check className="size-4" />
            完成
          </Button>
        ) : null}
      </div>
    </div>
  )
}
