import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import type { QuizRuntimeState } from '@/modules/quiz/public'
import { Button } from '@/shared/components/ui/button'

/**
 * Footer: navigation used to sit in the top-right, above the stem — the
 * furthest point from the thumb right after answering. Progress lives here
 * too so the header description stops being the only place that counts.
 */
export function NodeBoundQuizFooter({
  questionCount,
  answeredCount,
  index,
  currentState,
  setIndex,
  onFinish,
}: {
  questionCount: number
  answeredCount: number
  index: number
  currentState: QuizRuntimeState
  setIndex: (updater: (value: number) => number) => void
  onFinish: () => void
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-3">
      <span className="min-w-0 truncate text-xs tabular-nums text-muted-foreground">
        {questionCount > 1
          ? `已答 ${answeredCount} / ${questionCount}`
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
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
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
              onClick={() =>
                setIndex((value) => Math.min(questionCount - 1, value + 1))
              }
            >
              下一题
              <ChevronRight className="size-4" />
            </Button>
          </>
        ) : null}
        {/* Last question answered: an explicit way out beats hunting for ✕. */}
        {index >= questionCount - 1 && currentState.resolved ? (
          <Button
            type="button"
            size="sm"
            onClick={onFinish}
          >
            <Check className="size-4" />
            完成
          </Button>
        ) : null}
      </div>
    </div>
  )
}
